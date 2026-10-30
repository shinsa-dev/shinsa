import { Database as Sqlite } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REMOTE_APP_ORIGIN } from '@shinsa/core';
import type { Database, DatabaseStatement } from '../src/database.ts';
import { createWorld, respond } from '../src/router.ts';
import type { CloudConfig } from '../src/world.ts';

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
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/0001_remote.sql'), 'utf8'));
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
  allowedLogins: [],
};

export interface Harness {
  db: ReturnType<typeof createTestDatabase>;
  calls: UpstreamCall[];
  handlers: UpstreamHandler[];
  clock: { now: number };
  call: (path: string, init?: RequestInit & { session?: string; sameOrigin?: boolean }) => Promise<Response>;
  post: (
    path: string,
    body: unknown,
    options?: { session?: string; bearer?: string; sameOrigin?: boolean }
  ) => Promise<Response>;
  signIn: (login?: string, id?: number) => Promise<string>;
}

const GITHUB_USERS = new Map<string, { id: number; login: string }>();

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
        const { code } = JSON.parse(upstream.body) as { code: string };
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

  async function signIn(login = 'mona', id = 42) {
    const code = `code-${login}-${id}`;
    GITHUB_USERS.set(code, { id, login });
    const start = await call('/__remote/sign-in?return=/instances');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const oauth = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const done = await call(`/__remote/sign-in/callback?code=${code}&state=${state}`, {
      headers: { cookie: oauth },
    });
    const cookie =
      done.headers.getSetCookie().find((value) => value.startsWith('__Host-shinsa_session=')) ?? '';
    return cookie.split(';')[0]?.split('=')[1] ?? '';
  }

  return { db, calls, handlers, clock, call, post, signIn };
}

export async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}
