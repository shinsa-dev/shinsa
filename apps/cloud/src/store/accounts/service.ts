import { RemoteUser, RemoteUserId } from '@shinsa/core';
import { Clock, Context, Effect, Layer, type Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { TokenHash } from '../../crypto/schema.ts';
import { USER_COLUMNS } from '../shared/schema.ts';

import { SignInCode } from './schema.ts';

export class Accounts extends Context.Service<
  Accounts,
  {
    upsertUser(user: RemoteUser): Effect.Effect<void>;
    selectUser(id: RemoteUserId): Effect.Effect<Option.Option<RemoteUser>>;
    createSession(tokenHash: TokenHash, userId: RemoteUserId, expiresAt: number): Effect.Effect<void>;
    selectSessionUser(tokenHash: TokenHash): Effect.Effect<Option.Option<RemoteUser>>;
    removeSession(tokenHash: TokenHash): Effect.Effect<void>;
    createSignInCode(codeHash: TokenHash, code: SignInCode): Effect.Effect<void>;
    takeSignInCode(codeHash: TokenHash): Effect.Effect<Option.Option<SignInCode>>;
  }
>()('shinsa/cloud/store/Accounts') {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const users = sql.literal(USER_COLUMNS);

      const insertUser = SqlSchema.void({
        Request: Schema.Struct({ ...RemoteUser.fields, at: Schema.Number }),
        execute: (user) =>
          sql`INSERT INTO users (id, login, name, avatar_url, created_at) VALUES (${user.id}, ${user.login}, ${user.name}, ${user.avatarUrl}, ${user.at}) ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
      });
      const userById = SqlSchema.findOneOption({
        Request: RemoteUserId,
        Result: RemoteUser,
        execute: (id) => sql`SELECT ${users} FROM users WHERE id = ${id}`,
      });
      const insertSession = SqlSchema.void({
        Request: Schema.Struct({ tokenHash: TokenHash, userId: RemoteUserId, expiresAt: Schema.Number }),
        execute: (row) =>
          sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${row.tokenHash}, ${row.userId}, ${row.expiresAt})`,
      });
      const sessionUser = SqlSchema.findOneOption({
        Request: Schema.Struct({ tokenHash: TokenHash, now: Schema.Number }),
        Result: RemoteUser,
        execute: (row) =>
          sql`SELECT ${users} FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ${row.tokenHash} AND sessions.expires_at > ${row.now}`,
      });
      const sessionRemoval = SqlSchema.void({
        Request: TokenHash,
        execute: (hash) => sql`DELETE FROM sessions WHERE token_hash = ${hash}`,
      });
      const expiredCodesRemoval = SqlSchema.void({
        Request: Schema.Number,
        execute: (now) => sql`DELETE FROM sign_in_codes WHERE expires_at <= ${now}`,
      });
      const insertCode = SqlSchema.void({
        Request: Schema.Struct({ codeHash: TokenHash, ...SignInCode.fields }),
        execute: (row) =>
          sql`INSERT INTO sign_in_codes (code_hash, user_id, code_challenge, expires_at) VALUES (${row.codeHash}, ${row.userId}, ${row.codeChallenge}, ${row.expiresAt})`,
      });
      const codeTaking = SqlSchema.findOneOption({
        Request: TokenHash,
        Result: SignInCode,
        execute: (hash) =>
          sql`DELETE FROM sign_in_codes WHERE code_hash = ${hash} RETURNING user_id, code_challenge, expires_at`,
      });

      const upsertUser = Effect.fn('Accounts.upsertUser')(function* (user: RemoteUser) {
        yield* insertUser({ ...user, at: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const selectSessionUser = Effect.fn('Accounts.selectSessionUser')(function* (tokenHash: TokenHash) {
        return yield* sessionUser({ tokenHash, now: yield* Clock.currentTimeMillis });
      }, Effect.orDie);

      const createSignInCode = Effect.fn('Accounts.createSignInCode')(function* (
        codeHash: TokenHash,
        code: SignInCode
      ) {
        yield* expiredCodesRemoval(yield* Clock.currentTimeMillis);
        yield* insertCode({ codeHash, ...code });
      }, Effect.orDie);

      return Accounts.of({
        upsertUser,
        selectUser: Effect.fn('Accounts.selectUser')((id: RemoteUserId) => userById(id), Effect.orDie),
        createSession: Effect.fn('Accounts.createSession')(
          (tokenHash: TokenHash, userId: RemoteUserId, expiresAt: number) =>
            insertSession({ tokenHash, userId, expiresAt }),
          Effect.orDie
        ),
        selectSessionUser,
        removeSession: Effect.fn('Accounts.removeSession')(
          (hash: TokenHash) => sessionRemoval(hash),
          Effect.orDie
        ),
        createSignInCode,
        takeSignInCode: Effect.fn('Accounts.takeSignInCode')(
          (hash: TokenHash) => codeTaking(hash),
          Effect.orDie
        ),
      });
    })
  );
}
