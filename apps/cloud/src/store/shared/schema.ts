import { RemoteMember, RemoteUser, type RemoteUserId } from '@shinsa/core';
import { type Effect, type Option, Schema, SchemaTransformation } from 'effect';
import { camelToSnake, snakeToCamel } from 'effect/String';
import type { TokenHash } from '../../crypto/schema.ts';

export const SQL_NAMES = { transformQueryNames: camelToSnake, transformResultNames: snakeToCamel };

export const USER_COLUMNS = 'users.id, users.login, users.name, users.avatar_url';

export const Found = Schema.Struct({ found: Schema.Literal(1) });

export const Count = Schema.Struct({ total: Schema.Int }).pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({ decode: (row) => row.total, encode: (total) => ({ total }) })
  )
);

export const MemberRow = Schema.Struct({ ...RemoteUser.fields, addedAt: Schema.Number }).pipe(
  Schema.decodeTo(
    RemoteMember,
    SchemaTransformation.transform({
      decode: ({ addedAt, ...user }) => ({ user, addedAt }),
      encode: ({ user, addedAt }) => ({ ...user, addedAt }),
    })
  )
);

export interface Membership<Scope> {
  add(scope: Scope, userId: RemoteUserId): Effect.Effect<void>;
  has(scope: Scope, userId: RemoteUserId): Effect.Effect<boolean>;
  count(scope: Scope): Effect.Effect<number>;
  list(scope: Scope): Effect.Effect<ReadonlyArray<RemoteMember>>;
  remove(scope: Scope, userId: RemoteUserId): Effect.Effect<void>;
}

export interface MembershipTable {
  readonly name: string;
  readonly table: string;
  readonly scope: string;
  readonly time: string;
  readonly onRepeat: 'keep' | 'refresh';
}

export interface Invites<Scope> {
  replace(scope: Scope, tokenHash: TokenHash): Effect.Effect<void>;
  remove(scope: Scope): Effect.Effect<void>;
  select(tokenHash: TokenHash): Effect.Effect<Option.Option<Scope>>;
}

export interface InviteTable {
  readonly name: string;
  readonly table: string;
  readonly scope: string;
}
