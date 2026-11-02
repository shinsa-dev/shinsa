import { RemoteUserId } from '@shinsa/core';
import { Clock, Effect, Option, Schema } from 'effect';
import { type SqlClient, SqlSchema } from 'effect/sql';
import { Count, Found, MemberRow, type Membership, type MembershipTable, USER_COLUMNS } from './schema.ts';

export function createMembership<Scope extends string, Encoded extends string>(
  sql: SqlClient.SqlClient,
  ScopeId: Schema.Codec<Scope, Encoded>,
  table: MembershipTable
): Membership<Scope> {
  const Pair = Schema.Struct({ scope: ScopeId, userId: RemoteUserId });
  const columns = sql.literal(`${table.table}.${table.scope}, ${table.table}.user_id`);
  const onRepeat =
    table.onRepeat === 'refresh'
      ? sql.literal(`DO UPDATE SET ${table.time} = excluded.${table.time}`)
      : sql.literal('DO NOTHING');
  const from = sql.literal(table.table);
  const scope = sql.literal(table.scope);
  const time = sql.literal(table.time);

  const insert = SqlSchema.void({
    Request: Schema.Struct({ ...Pair.fields, at: Schema.Number }),
    execute: (row) =>
      sql`INSERT INTO ${from} (${scope}, user_id, ${time}) VALUES (${row.scope}, ${row.userId}, ${row.at}) ON CONFLICT (${columns}) ${onRepeat}`,
  });
  const select = SqlSchema.findOneOption({
    Request: Pair,
    Result: Found,
    execute: (pair) =>
      sql`SELECT 1 AS found FROM ${from} WHERE ${scope} = ${pair.scope} AND user_id = ${pair.userId}`,
  });
  const total = SqlSchema.findOne({
    Request: ScopeId,
    Result: Count,
    execute: (id) => sql`SELECT COUNT(*) AS total FROM ${from} WHERE ${scope} = ${id}`,
  });
  const rows = SqlSchema.findAll({
    Request: ScopeId,
    Result: MemberRow,
    execute: (id) =>
      sql`SELECT ${sql.literal(USER_COLUMNS)}, ${from}.${time} AS added_at FROM ${from} JOIN users ON users.id = ${from}.user_id WHERE ${from}.${scope} = ${id} ORDER BY ${from}.${time}, users.login`,
  });
  const removal = SqlSchema.void({
    Request: Pair,
    execute: (pair) => sql`DELETE FROM ${from} WHERE ${scope} = ${pair.scope} AND user_id = ${pair.userId}`,
  });

  return {
    add: Effect.fn(`${table.name}.add`)(function* (id: Scope, userId: RemoteUserId) {
      yield* insert({ scope: id, userId, at: yield* Clock.currentTimeMillis });
    }, Effect.orDie),
    has: Effect.fn(`${table.name}.has`)(
      (id: Scope, userId: RemoteUserId) => Effect.map(select({ scope: id, userId }), Option.isSome),
      Effect.orDie
    ),
    count: Effect.fn(`${table.name}.count`)((id: Scope) => total(id), Effect.orDie),
    list: Effect.fn(`${table.name}.list`)((id: Scope) => rows(id), Effect.orDie),
    remove: Effect.fn(`${table.name}.remove`)(
      (id: Scope, userId: RemoteUserId) => removal({ scope: id, userId }),
      Effect.orDie
    ),
  };
}
