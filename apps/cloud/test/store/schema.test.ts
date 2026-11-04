import { describe, expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { runSqlTest } from '../layers.ts';

const TABLES = [
  'instance_guests',
  'instance_handoffs',
  'instance_invites',
  'instance_members',
  'instance_requesters',
  'instances',
  'pair_sessions',
  'sessions',
  'sign_in_codes',
  'slack_events',
  'slack_links',
  'slack_posts',
  'slack_threads',
  'slack_workspaces',
  'team_invites',
  'team_members',
  'team_requesters',
  'teams',
  'users',
];

const TableRow = Schema.Struct({ name: Schema.String, strict: Schema.Int, withoutRowid: Schema.Int });

const ForeignKeyRow = Schema.Struct({
  tableName: Schema.String,
  columnName: Schema.String,
  indexed: Schema.Int,
});

const ExpiryRow = Schema.Struct({ tableName: Schema.String, indexed: Schema.Int });

const readSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: TableRow,
    execute: () =>
      sql`SELECT name, strict, wr AS without_rowid FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  })(undefined);
  const foreignKeys = yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: ForeignKeyRow,
    execute: () =>
      sql`SELECT tables.name AS table_name, keys."from" AS column_name, EXISTS (SELECT 1 FROM pragma_index_list(tables.name) AS indexes JOIN pragma_index_info(indexes.name) AS columns WHERE columns.seqno = 0 AND columns.name = keys."from") AS indexed FROM sqlite_master AS tables JOIN pragma_foreign_key_list(tables.name) AS keys WHERE tables.type = 'table' ORDER BY tables.name, keys."from"`,
  })(undefined);
  const expiries = yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: ExpiryRow,
    execute: () =>
      sql`SELECT tables.name AS table_name, EXISTS (SELECT 1 FROM pragma_index_list(tables.name) AS indexes JOIN pragma_index_info(indexes.name) AS columns WHERE columns.seqno = 0 AND columns.name = 'expires_at') AS indexed FROM sqlite_master AS tables JOIN pragma_table_info(tables.name) AS info WHERE tables.type = 'table' AND info.name = 'expires_at' ORDER BY tables.name`,
  })(undefined);
  return { tables, foreignKeys, expiries };
}).pipe(Effect.orDie);

describe('schema', () => {
  test('the schema has exactly the tables the store uses, every one strict', async () => {
    const { tables } = await runSqlTest(readSchema);
    expect(tables.map((table) => table.name)).toEqual(TABLES);
    expect(tables.filter((table) => table.strict !== 1)).toEqual([]);
  });

  test('tables keyed by a token hash or a composite key are stored without a rowid', async () => {
    const { tables } = await runSqlTest(readSchema);
    expect(tables.filter((table) => table.withoutRowid === 1).map((table) => table.name)).toEqual([
      'instance_guests',
      'instance_handoffs',
      'instance_members',
      'instance_requesters',
      'sessions',
      'sign_in_codes',
      'slack_events',
      'slack_links',
      'slack_posts',
      'slack_threads',
      'team_members',
      'team_requesters',
    ]);
  });

  test('every foreign key leads an index, so a cascade never scans its table', async () => {
    const { foreignKeys } = await runSqlTest(readSchema);
    expect(foreignKeys.length).toBeGreaterThan(0);
    expect(foreignKeys.filter((key) => key.indexed !== 1)).toEqual([]);
  });

  test('every expiry is indexed, so a sweep never scans its table', async () => {
    const { expiries } = await runSqlTest(readSchema);
    expect(expiries.map((expiry) => expiry.tableName)).toEqual([
      'pair_sessions',
      'sessions',
      'sign_in_codes',
    ]);
    expect(expiries.filter((expiry) => expiry.indexed !== 1)).toEqual([]);
  });

  test('a value of the wrong type is refused instead of stored', async () => {
    const outcome = await runSqlTest(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* Effect.exit(
          sql`INSERT INTO users (id, login, created_at) VALUES ('user-1', 'kai', 'yesterday')`
        );
      })
    );
    expect(outcome._tag).toBe('Failure');
  });
});
