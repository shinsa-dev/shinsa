import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { ConfigProvider, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { RelayRooms } from '../src/http/worker.ts';
import { CloudServices } from '../src/layers.ts';
import { RELAY_ROOM_ORIGIN } from '../src/relay/schema.ts';
import { SQL_NAMES } from '../src/store/shared/schema.ts';

export const TEST_NOW = 1_800_000_000_000;

export const TEST_ENV = {
  APP_ORIGIN: 'https://app.shinsa.dev',
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
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

export function createUpstream(): Upstream {
  const calls: UpstreamCall[] = [];
  const handlers: UpstreamHandler[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const call: UpstreamCall = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(call);
    for (const handler of handlers) {
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
    Layer.provideMerge(SqlTest),
    Layer.provide([
      ConfigProvider.layer(ConfigProvider.fromUnknown({ ...TEST_ENV, ...env })),
      Layer.succeed(FetchHttpClient.Fetch, upstream.fetch),
      Layer.succeed(RelayRooms, {
        fetch: (instanceId, room) =>
          upstream.fetch(
            new Request(room.url.replace(RELAY_ROOM_ORIGIN, `https://${instanceId}.relay.test`), room)
          ),
      }),
    ]),
    Layer.provideMerge(ClockTest)
  );

export const runTest = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof servicesTest>>>,
  options: ServicesOptions = {}
) => Effect.runPromise(effect.pipe(Effect.provide(servicesTest(options))));

export const runSqlTest = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqlTest)));

export const flipTest = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof servicesTest>>>,
  options: ServicesOptions = {}
) => runTest(Effect.flip(effect), options);
