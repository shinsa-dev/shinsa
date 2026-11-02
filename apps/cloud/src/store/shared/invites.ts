import { Clock, Effect, Option, Schema } from 'effect';
import { type SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../../crypto/schema.ts';
import type { Invites, InviteTable } from './schema.ts';

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
