import { isSameSecret, REMOTE_SESSION_COOKIE } from '@shinsa/core';
import { RemoteApi } from '@shinsa/core/remote/api';
import { SignInFailed } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { assertPageRequest, selectRequestUser, selectSessionToken } from '../auth/sessions.ts';
import { CloudCrypto } from '../crypto/crypto.ts';
import { serializeExpiredCookie } from '../http/cookies.ts';
import { appendResponseHeader } from '../http/responses.ts';
import { Accounts } from '../store/accounts.ts';
import { createSession, SIGN_IN_EXPIRED } from './sign-in.ts';

export const SessionHandlers = HttpApiBuilder.group(
  RemoteApi,
  'session',
  Effect.fn(function* (handlers) {
    const accounts = yield* Accounts;
    const crypto = yield* CloudCrypto;

    const findCodeUser = Effect.fn('session.findCodeUser')(function* (code: string, verifier: string) {
      const failed = new SignInFailed({ message: SIGN_IN_EXPIRED });
      const row = yield* accounts.takeSignInCode(yield* crypto.hashToken(Redacted.make(code)));
      const challenge = yield* crypto.createCodeChallenge(Redacted.make(verifier));
      const now = yield* Clock.currentTimeMillis;
      if (
        Option.isNone(row) ||
        !isSameSecret(challenge, row.value.codeChallenge) ||
        row.value.expiresAt <= now
      )
        return yield* failed;
      const user = yield* accounts.selectUser(row.value.userId);
      if (Option.isNone(user)) return yield* failed;
      return { id: row.value.userId, user: user.value };
    });

    return handlers
      .handle('read', () => Effect.map(selectRequestUser, (user) => ({ user: Option.getOrNull(user) })))
      .handle('signOut', () =>
        Effect.gen(function* () {
          yield* assertPageRequest();
          const token = selectSessionToken(yield* HttpServerRequest.HttpServerRequest);
          if (Option.isSome(token)) yield* accounts.removeSession(yield* crypto.hashToken(token.value));
          yield* appendResponseHeader('set-cookie', serializeExpiredCookie(REMOTE_SESSION_COOKIE));
          return { ok: true as const };
        })
      )
      .handle('signInToken', ({ payload }) =>
        Effect.gen(function* () {
          const { id, user } = yield* findCodeUser(payload.code, payload.codeVerifier);
          const token = yield* createSession(id);
          return { token: Redacted.value(token), user };
        })
      );
  })
);
