import { Database as Sqlite } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type MachineCredentials,
  type PairPollResponse,
  type PairStartResponse,
  REMOTE_APP_ORIGIN,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  resolvePairApprovePath,
  serializePublicKey,
} from '@shinsa/core';
import { createCodeChallenge } from '../src/crypto.ts';
import type { Database, DatabaseStatement } from '../src/database.ts';
import { createWorld, respond } from '../src/router.ts';
import type { CloudConfig, CloudWorld } from '../src/world.ts';

type SqlValue = string | number | null;

function createStatement(sqlite: Sqlite, sql: string, values: SqlValue[] = []): DatabaseStatement {
  return {
    bind: (...next: unknown[]) => createStatement(sqlite, sql, next as SqlValue[]),
    first: <T>() => Promise.resolve((sqlite.query(sql).get(...values) as T | undefined) ?? null),
    all: <T>() => Promise.resolve({ results: sqlite.query(sql).all(...values) as T[] }),
    run: () => Promise.resolve(sqlite.query(sql).run(...values)),
  };
}

function createTestDatabase(): Database & { sqlite: Sqlite } {
  const sqlite = new Sqlite(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = join(import.meta.dirname, '../migrations');
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
  return { sqlite, prepare: (sql) => createStatement(sqlite, sql) };
}

interface UpstreamCall {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

type UpstreamHandler = (call: UpstreamCall) => Response | Promise<Response>;

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

export const TEST_CONFIG: CloudConfig = {
  origin: REMOTE_APP_ORIGIN,
  githubClientId: 'client-id',
  githubClientSecret: 'client-secret',
  cloudflareAccountId: 'account-1',
  cloudflareApiToken: 'api-token',
  tunnelZone: 'shinsa.dev',
  maxInstances: 50,
};

export interface Harness {
  db: ReturnType<typeof createTestDatabase>;
  world: CloudWorld;
  calls: UpstreamCall[];
  handlers: UpstreamHandler[];
  clock: { now: number };
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

export function createHarness(config: Partial<CloudConfig> = {}): Harness {
  const db = createTestDatabase();
  const calls: UpstreamCall[] = [];
  const cloudflare = createCloudflareApi();
  const handlers: UpstreamHandler[] = [];
  const clock = { now: 1_800_000_000_000 };
  const world = createWorld({
    db,
    assets: (request) => Promise.resolve(new Response(`asset ${new URL(request.url).pathname}`)),
    fetch: async (url, init = {}) => {
      const upstream: UpstreamCall = {
        method: init.method ?? 'GET',
        url,
        headers: new Headers(init.headers),
        body: await new Response(init.body ?? null).text(),
      };
      calls.push(upstream);
      for (const handler of handlers) {
        const answer = await handler(upstream);
        if (answer.status !== 599) return answer;
      }
      if (url === 'https://github.com/login/oauth/access_token') {
        const { code, code_verifier: verifier } = JSON.parse(upstream.body) as {
          code: string;
          code_verifier: string;
        };
        const challenge = GITHUB_CHALLENGES.get(code);
        if (challenge && challenge !== (await createCodeChallenge(verifier)))
          return Response.json({ error: 'bad_verification_code' });
        return Response.json({ access_token: `token-for-${code}` });
      }
      if (url === 'https://api.github.com/user') {
        const code = (upstream.headers.get('authorization') ?? '').replace('Bearer token-for-', '');
        return Response.json(GITHUB_USERS.get(code) ?? { message: 'Bad credentials' }, {
          status: GITHUB_USERS.has(code) ? 200 : 401,
        });
      }
      const api = cloudflare(upstream);
      if (api) return api;
      return new Response('no upstream', { status: 404 });
    },
    now: () => clock.now,
    config: { ...TEST_CONFIG, ...config },
  });

  async function call(
    path: string,
    init: RequestInit & { session?: string; sameOrigin?: boolean } = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.session) headers.set('cookie', `__Host-shinsa_session=${init.session}`);
    if (init.sameOrigin) headers.set('origin', REMOTE_APP_ORIGIN);
    return respond(new Request(`${REMOTE_APP_ORIGIN}${path}`, { ...init, headers }), world);
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

  return { db, world, calls, handlers, clock, call, post, signIn, signInNative };
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
