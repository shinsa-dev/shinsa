import { type RemoteMember, RemoteUser, RemoteUserId } from '@shinsa/core';
import { Clock, Effect, Option, Schema } from 'effect';
import { camelToSnake, snakeToCamel } from 'effect/String';
import { type SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../crypto/crypto.ts';

export const SQL_NAMES = { transformQueryNames: camelToSnake, transformResultNames: snakeToCamel };

export const USER_COLUMNS = 'users.id, users.login, users.name, users.avatar_url';

export const Found = Schema.Struct({ found: Schema.Literal(1) });

export const Total = Schema.Struct({ total: Schema.Int });

export const resolveTotal = (row: typeof Total.Type) => row.total;

const MemberRow = Schema.Struct({ ...RemoteUser.fields, addedAt: Schema.Number });

function resolveMember({ addedAt, ...user }: typeof MemberRow.Type): RemoteMember {
  return { user, addedAt };
}

export interface Membership<Scope> {
  add(scope: Scope, userId: RemoteUserId): Effect.Effect<void>;
  has(scope: Scope, userId: RemoteUserId): Effect.Effect<boolean>;
  count(scope: Scope): Effect.Effect<number>;
  list(scope: Scope): Effect.Effect<ReadonlyArray<RemoteMember>>;
  remove(scope: Scope, userId: RemoteUserId): Effect.Effect<void>;
}

interface MembershipTable {
  readonly name: string;
  readonly table: string;
  readonly scope: string;
  readonly time: string;
  readonly onRepeat: 'keep' | 'refresh';
}

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
    Result: Total,
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
    count: Effect.fn(`${table.name}.count`)((id: Scope) => Effect.map(total(id), resolveTotal), Effect.orDie),
    list: Effect.fn(`${table.name}.list`)(
      (id: Scope) => Effect.map(rows(id), (members) => members.map(resolveMember)),
      Effect.orDie
    ),
    remove: Effect.fn(`${table.name}.remove`)(
      (id: Scope, userId: RemoteUserId) => removal({ scope: id, userId }),
      Effect.orDie
    ),
  };
}

export interface Invites<Scope> {
  replace(scope: Scope, tokenHash: TokenHash): Effect.Effect<void>;
  remove(scope: Scope): Effect.Effect<void>;
  select(tokenHash: TokenHash): Effect.Effect<Option.Option<Scope>>;
}

interface InviteTable {
  readonly name: string;
  readonly table: string;
  readonly scope: string;
}

export function createInvites<Scope extends string, Encoded extends string>(
  sql: SqlClient.SqlClient,
  ScopeId: Schema.Codec<Scope, Encoded>,
  table: InviteTable
): Invites<Scope> {
  const from = sql.literal(table.table);
  const scope = sql.literal(table.scope);

  const upsert = SqlSchema.void({
    Request: Schema.Struct({ scope: ScopeId, tokenHash: TokenHash, at: Schema.Number }),
    execute: (row) =>
      sql`INSERT INTO ${from} (${scope}, token_hash, created_at) VALUES (${row.scope}, ${row.tokenHash}, ${row.at}) ON CONFLICT (${scope}) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
  });
  const removal = SqlSchema.void({
    Request: ScopeId,
    execute: (id) => sql`DELETE FROM ${from} WHERE ${scope} = ${id}`,
  });
  const lookup = SqlSchema.findOneOption({
    Request: TokenHash,
    Result: Schema.Struct({ scope: ScopeId }),
    execute: (hash) => sql`SELECT ${scope} AS scope FROM ${from} WHERE token_hash = ${hash}`,
  });

  return {
    replace: Effect.fn(`${table.name}.replace`)(function* (id: Scope, tokenHash: TokenHash) {
      yield* upsert({ scope: id, tokenHash, at: yield* Clock.currentTimeMillis });
    }, Effect.orDie),
    remove: Effect.fn(`${table.name}.remove`)((id: Scope) => removal(id), Effect.orDie),
    select: Effect.fn(`${table.name}.select`)(
      (tokenHash: TokenHash) =>
        Effect.map(
          lookup(tokenHash),
          Option.map((row) => row.scope)
        ),
      Effect.orDie
    ),
  };
}
