import { Database as Sqlite } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import {
  encodeText,
  type MachineCredentials,
  type PairPollResponse,
  type PairStartResponse,
  REMOTE_APP_ORIGIN,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  resolvePairApprovePath,
  serializeBase64Url,
  serializeHex,
  serializePublicKey,
} from '@shinsa/core';
import { type Clock, Clock as ClockService, ConfigProvider, Context, Duration, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { SqlClient } from 'effect/sql';
import { makeCloudHandler } from '../src/app.ts';
import { Assets, WorkerContext } from '../src/http/worker.ts';
import { SQL_NAMES } from '../src/store/tables.ts';

export interface CloudConfig {
  origin: string;
  githubClientId: string;
  githubClientSecret: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  tunnelZone: string;
  previewOrigin: string;
  maxInstances: number;
  slackClientId: string;
  slackClientSecret: string;
  slackSigningSecret: string;
  slackTokenKey: string;
}

export const TEST_CONFIG: CloudConfig = {
  origin: REMOTE_APP_ORIGIN,
  githubClientId: 'client-id',
  githubClientSecret: 'client-secret',
  cloudflareAccountId: 'account-1',
  cloudflareApiToken: 'api-token',
  tunnelZone: 'shinsa.dev',
  previewOrigin: 'https://shinsa.page',
  maxInstances: 50,
  slackClientId: 'slack-client',
  slackClientSecret: 'slack-secret',
  slackSigningSecret: 'slack-signing',
  slackTokenKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

function resolveEnv(config: CloudConfig) {
  return {
    APP_ORIGIN: config.origin,
    GITHUB_CLIENT_ID: config.githubClientId,
    GITHUB_CLIENT_SECRET: config.githubClientSecret,
    CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: config.cloudflareApiToken,
    TUNNEL_ZONE: config.tunnelZone,
    PREVIEW_ZONE: new URL(config.previewOrigin).host,
    MAX_INSTANCES: String(config.maxInstances),
    SLACK_CLIENT_ID: config.slackClientId,
    SLACK_CLIENT_SECRET: config.slackClientSecret,
    SLACK_SIGNING_SECRET: config.slackSigningSecret,
    SLACK_TOKEN_KEY: config.slackTokenKey,
  };
}

let databases = 0;

function createTestDatabase() {
  const filename = `file:cloud-test-${++databases}?mode=memory&cache=shared`;
  const sqlite = new Sqlite(filename);
  const migrations = join(import.meta.dirname, '../migrations');
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
  return { sqlite, filename };
}

interface UpstreamCall {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

type UpstreamHandler = (call: UpstreamCall) => Response | Promise<Response>;

const PASS = 599;

function answerApi(result: unknown) {
  return Response.json({ success: true, result });
}

function createCloudflareApi() {
  let tunnels = 0;
  let records = 0;
  return (call: UpstreamCall): Response | null => {
    const path = new URL(call.url).pathname;
    if (call.method === 'GET' && path === '/client/v4/zones') return answerApi([{ id: 'zone-1' }]);
    if (call.method === 'POST' && path.endsWith('/cfd_tunnel'))
      return answerApi({ id: `tunnel-${++tunnels}` });
    if (call.method === 'PUT' && path.endsWith('/configurations')) return answerApi({});
    if (call.method === 'GET' && path.endsWith('/token')) return answerApi(`tunnel-token-${tunnels}`);
    if (call.method === 'POST' && path.endsWith('/dns_records'))
      return answerApi({ id: `record-${++records}` });
    if (call.method === 'DELETE') return answerApi({});
    return null;
  };
}

export async function createCodeChallenge(verifier: string) {
  return serializeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeText(verifier))));
}

export async function createSlackSignature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encodeText(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeText(`v0:${timestamp}:${body}`)));
  return `v0=${serializeHex(digest)}`;
}

function createTestClock(clock: { now: number }): Clock.Clock {
  return {
    currentTimeMillisUnsafe: () => clock.now,
    currentTimeMillis: Effect.sync(() => clock.now),
    currentTimeNanosUnsafe: () => BigInt(clock.now) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(clock.now) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => process.hrtime.bigint(),
    monotonicTimeNanos: Effect.sync(() => process.hrtime.bigint()),
    sleep: (duration) => Effect.promise(() => Bun.sleep(Duration.toMillis(duration))),
  };
}

interface World {
  config: CloudConfig;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface Harness {
  db: { sqlite: Sqlite };
  world: World;
  calls: UpstreamCall[];
  handlers: UpstreamHandler[];
  clock: { now: number };
  settle: () => Promise<void>;
  request: (request: Request) => Promise<Response>;
  call: (path: string, init?: RequestInit & { session?: string; sameOrigin?: boolean }) => Promise<Response>;
  post: (
    path: string,
    body: unknown,
    options?: { session?: string; bearer?: string; sameOrigin?: boolean }
  ) => Promise<Response>;
  signIn: (login?: string, id?: number, name?: string) => Promise<string>;
  signInNative: (login?: string, id?: number) => Promise<string>;
}

export const NATIVE_VERIFIER = 'native-verifier-that-is-long-enough-for-pkce-0123456789';

interface GitHubTestUser {
  id: number;
  login: string;
  name?: string;
}

const GITHUB_USERS = new Map<string, GitHubTestUser>();

const GITHUB_CHALLENGES = new Map<string, string>();

export function registerGitHubCode(code: string, user: GitHubTestUser, challenge: string) {
  GITHUB_USERS.set(code, user);
  GITHUB_CHALLENGES.set(code, challenge);
}

async function answerGitHub(upstream: UpstreamCall) {
  if (upstream.url === 'https://github.com/login/oauth/access_token') {
    const { code, code_verifier: verifier } = JSON.parse(upstream.body) as {
      code: string;
      code_verifier: string;
    };
    const challenge = GITHUB_CHALLENGES.get(code);
    if (challenge && challenge !== (await createCodeChallenge(verifier)))
      return Response.json({ error: 'bad_verification_code' });
    return Response.json({ access_token: `token-for-${code}` });
  }
  if (upstream.url === 'https://api.github.com/user') {
    const code = (upstream.headers.get('authorization') ?? '').replace('Bearer token-for-', '');
    return Response.json(GITHUB_USERS.get(code) ?? { message: 'Bad credentials' }, {
      status: GITHUB_USERS.has(code) ? 200 : 401,
    });
  }
  return null;
}

export function createHarness(overrides: Partial<CloudConfig> = {}): Harness {
  const db = createTestDatabase();
  const calls: UpstreamCall[] = [];
  const cloudflare = createCloudflareApi();
  const handlers: UpstreamHandler[] = [];
  const clock = { now: 1_800_000_000_000 };
  const deferred: Promise<unknown>[] = [];
  let built: ReturnType<typeof makeCloudHandler> | null = null;

  const upstreamFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const upstream: UpstreamCall = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(upstream);
    for (const handler of handlers) {
      const answer = await handler(upstream);
      if (answer.status !== PASS) return answer;
    }
    return (
      (await answerGitHub(upstream)) ?? cloudflare(upstream) ?? new Response('no upstream', { status: 404 })
    );
  };

  const config = new Proxy(
    { ...TEST_CONFIG, ...overrides },
    {
      set: (target, key, value) => {
        Reflect.set(target, key, value);
        built = null;
        return true;
      },
    }
  );

  const world: World = { config, fetch: upstreamFetch };

  const Sql = Layer.effectDiscard(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe('PRAGMA foreign_keys = ON'))
  ).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: db.filename, disableWAL: true, ...SQL_NAMES })),
    Layer.orDie
  );

  function build() {
    built ??= makeCloudHandler(
      Layer.mergeAll(
        Sql,
        ConfigProvider.layer(ConfigProvider.fromUnknown(resolveEnv(config))),
        Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
          world.fetch(input, init)) as typeof globalThis.fetch),
        Layer.succeed(ClockService.Clock, createTestClock(clock)),
        Layer.succeed(Assets, {
          fetch: (asset) => Promise.resolve(new Response(`asset ${new URL(asset.url).pathname}`)),
        })
      )
    );
    return built.handler;
  }

  const worker = Context.make(WorkerContext, { waitUntil: (work) => deferred.push(work) });

  const request = (incoming: Request) => build()(incoming, worker);

  async function call(
    path: string,
    init: RequestInit & { session?: string; sameOrigin?: boolean } = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.session) headers.set('cookie', `__Host-shinsa_session=${init.session}`);
    if (init.sameOrigin) headers.set('origin', REMOTE_APP_ORIGIN);
    return request(new Request(`${REMOTE_APP_ORIGIN}${path}`, { ...init, headers }));
  }

  async function post(
    path: string,
    body: unknown,
    options: { session?: string; bearer?: string; sameOrigin?: boolean } = {}
  ) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
    return call(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      session: options.session,
      sameOrigin: options.sameOrigin ?? true,
    });
  }

  async function signIn(login = 'mona', id = 42, name?: string) {
    const code = `code-${login}-${id}`;
    GITHUB_USERS.set(code, { id, login, ...(name ? { name } : {}) });
    const start = await call('/__remote/sign-in?return=/');
    const authorize = new URL(start.headers.get('location') ?? '');
    const state = authorize.searchParams.get('state') ?? '';
    GITHUB_CHALLENGES.set(code, authorize.searchParams.get('code_challenge') ?? '');
    const oauth = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const done = await call(`/__remote/sign-in/callback?code=${code}&state=${state}`, {
      headers: { cookie: oauth },
    });
    const cookie =
      done.headers.getSetCookie().find((value) => value.startsWith('__Host-shinsa_session=')) ?? '';
    return cookie.split(';')[0]?.split('=')[1] ?? '';
  }

  async function signInNative(login = 'mona', id = 42) {
    const code = `native-code-${login}-${id}`;
    GITHUB_USERS.set(code, { id, login });
    const challenge = await createCodeChallenge(NATIVE_VERIFIER);
    const start = await call(
      `/__remote/sign-in?client=native&redirect=shinsa://signed-in&code_challenge=${challenge}`
    );
    const authorize = new URL(start.headers.get('location') ?? '');
    GITHUB_CHALLENGES.set(code, authorize.searchParams.get('code_challenge') ?? '');
    const oauth = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const done = await call(
      `/__remote/sign-in/callback?code=${code}&state=${authorize.searchParams.get('state') ?? ''}`,
      { headers: { cookie: oauth } }
    );
    const appCode = new URL(done.headers.get('location') ?? '').searchParams.get('code') ?? '';
    const answer = await post(
      '/__remote/sign-in/token',
      { code: appCode, codeVerifier: NATIVE_VERIFIER },
      { sameOrigin: false }
    );
    return ((await answer.json()) as { token: string }).token;
  }

  async function settle() {
    while (deferred.length > 0) await deferred.shift();
  }

  return { db, world, calls, handlers, clock, settle, request, call, post, signIn, signInNative };
}

export async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}

export async function pairMachine(
  harness: Harness,
  session: string,
  name = 'Studio',
  auth: { session?: string; bearer?: string; sameOrigin?: boolean } = { session }
) {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = await serializePublicKey(pair.publicKey);
  const start = await readJson<PairStartResponse>(
    await harness.post(REMOTE_PATHS.pairStart, { name, publicKey, version: '1' })
  );
  await harness.post(resolvePairApprovePath(start.claimCode), {}, auth);
  const claimed = await readJson<PairPollResponse>(
    await harness.post(REMOTE_PATHS.pairPoll, { claimCode: start.claimCode, pollSecret: start.pollSecret })
  );
  if (claimed.status !== 'claimed') throw new Error('Pairing was not claimed.');
  return claimed.credentials;
}

export function heartbeat(
  harness: Harness,
  credentials: MachineCredentials,
  localUrl = 'http://127.0.0.1:7446'
) {
  return harness.post(
    REMOTE_PATHS.heartbeat,
    { localUrl, version: '1' },
    { bearer: credentials.machineToken, sameOrigin: false }
  );
}
