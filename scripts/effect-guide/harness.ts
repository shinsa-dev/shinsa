import { SqliteClient } from '@effect/sql-sqlite-bun';
import { ConfigProvider, Effect, Layer } from 'effect';
import { camelToSnake, snakeToCamel } from 'effect/String';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { Machines } from './machines.ts';

export const SESSION_TOKEN = 'dev-token';

const SqlTest = SqliteClient.layer({
  filename: ':memory:',
  transformQueryNames: camelToSnake,
  transformResultNames: snakeToCamel,
});

const SchemaTest = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, paired_at INTEGER NOT NULL)`;
  })
);

export const ConfigTest = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ GUIDE_SESSION_TOKEN: SESSION_TOKEN, GUIDE_TUNNEL_TOKEN: 'tunnel-token' })
);

export const MachinesTest = Machines.layer.pipe(
  Layer.provideMerge(SchemaTest),
  Layer.provide(SqlTest),
  Layer.orDie
);

export const runTest = <A, E>(effect: Effect.Effect<A, E, Machines>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(MachinesTest, TestClock.layer()))));
