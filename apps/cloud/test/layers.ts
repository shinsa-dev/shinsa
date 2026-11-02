import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { ConfigProvider, Effect, Layer, Logger } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { CloudServices } from '../src/layers.ts';
import { SQL_NAMES } from '../src/store/tables.ts';

export const TEST_NOW = 1_800_000_000_000;

export const TEST_ENV = {
  APP_ORIGIN: 'https://app.shinsa.dev',
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
  CLOUDFLARE_ACCOUNT_ID: 'account-1',
  CLOUDFLARE_API_TOKEN: 'api-token',
  TUNNEL_ZONE: 'shinsa.dev',
  PREVIEW_ZONE: 'shinsa.page',
  MAX_INSTANCES: '50',
  SLACK_CLIENT_ID: 'slack-client',
  SLACK_CLIENT_SECRET: 'slack-secret',
  SLACK_SIGNING_SECRET: 'slack-signing',
  SLACK_TOKEN_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

const MIGRATIONS = join(import.meta.dirname, '../migrations');

function listMigrationStatements() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .flatMap((name) => readFileSync(join(MIGRATIONS, name), 'utf8').split(/;\s*(?:\n|$)/))
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

const Migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe('PRAGMA foreign_keys = ON');
    for (const statement of listMigrationStatements()) yield* sql.unsafe(statement);
  })
);

const SqlTest = Migrated.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:', ...SQL_NAMES })),
  Layer.orDie
);

const ClockTest = Layer.effectDiscard(TestClock.setTime(TEST_NOW)).pipe(
  Layer.provideMerge(TestClock.layer())
);

interface UpstreamCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

export type UpstreamHandler = (call: UpstreamCall) => Response | null;

export interface Upstream {
  readonly calls: UpstreamCall[];
  readonly handlers: UpstreamHandler[];
  readonly fetch: typeof globalThis.fetch;
}

function answerApi(result: unknown) {
  return Response.json({ success: true, result });
}

function createCloudflareApi(): UpstreamHandler {
  let tunnels = 0;
  let records = 0;
  return (call) => {
    const { hostname, pathname } = new URL(call.url);
    if (hostname !== 'api.cloudflare.com') return null;
    if (call.method === 'GET' && pathname === '/client/v4/zones') return answerApi([{ id: 'zone-1' }]);
    if (call.method === 'POST' && pathname.endsWith('/cfd_tunnel'))
      return answerApi({ id: `tunnel-${++tunnels}` });
    if (call.method === 'PUT' && pathname.endsWith('/configurations')) return answerApi({});
    if (call.method === 'GET' && pathname.endsWith('/token')) return answerApi(`tunnel-token-${tunnels}`);
    if (call.method === 'POST' && pathname.endsWith('/dns_records'))
      return answerApi({ id: `record-${++records}` });
    if (call.method === 'DELETE') return answerApi({});
    return null;
  };
}

export function createUpstream(): Upstream {
  const calls: UpstreamCall[] = [];
  const handlers: UpstreamHandler[] = [];
  const cloudflare = createCloudflareApi();
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const call: UpstreamCall = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(call);
    for (const handler of [...handlers, cloudflare]) {
      const answer = handler(call);
      if (answer) return answer;
    }
    return new Response('no upstream', { status: 404 });
  };
  return { calls, handlers, fetch: fetch as typeof globalThis.fetch };
}

export interface ServicesOptions {
  readonly upstream?: Upstream;
  readonly env?: Record<string, string>;
}

export const servicesTest = ({ upstream = createUpstream(), env = {} }: ServicesOptions = {}) =>
  CloudServices.pipe(
    Layer.provide([
      SqlTest,
      ConfigProvider.layer(ConfigProvider.fromUnknown({ ...TEST_ENV, ...env })),
      Layer.succeed(FetchHttpClient.Fetch, upstream.fetch),
    ]),
    Layer.provideMerge(ClockTest)
  );

export const runTest = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof servicesTest>>>,
  options: ServicesOptions = {}
) => Effect.runPromise(effect.pipe(Effect.provide(servicesTest(options))));

export const flipTest = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof servicesTest>>>,
  options: ServicesOptions = {}
) => runTest(Effect.flip(effect), options);

interface LogEntry {
  readonly level: string;
  readonly message: unknown;
}

export function createLogRecorder() {
  const entries: LogEntry[] = [];
  const logger = Logger.make(({ logLevel, message }) => {
    entries.push({ level: logLevel, message });
  });
  return { entries, layer: Logger.layer([logger]) };
}
