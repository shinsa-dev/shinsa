import { REMOTE_SESSION_COOKIE, type RemoteUser, RemoteUserId } from '@shinsa/core';
import type { CurrentUser } from '@shinsa/core/remote/api';
import { Forbidden } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { CloudConfig } from '../config/service.ts';
import { CloudCrypto } from '../crypto/service.ts';
import { Accounts } from '../store/accounts/service.ts';
import { BEARER, SAFE_METHODS, SESSION_TTL } from './schema.ts';

export function selectBearer(request: HttpServerRequest.HttpServerRequest) {
  const header = request.headers.authorization ?? '';
  return header.startsWith(BEARER) ? Option.some(Redacted.make(header.slice(BEARER.length))) : Option.none();
}

export function selectSessionToken(request: HttpServerRequest.HttpServerRequest) {
  return Option.orElse(selectBearer(request), () =>
    Option.map(Option.fromNullishOr(request.cookies[REMOTE_SESSION_COOKIE]), (token) => Redacted.make(token))
  );
}

export const asCurrentUser = (user: RemoteUser) => ({ ...user, id: RemoteUserId.make(user.id) });

export const selectSessionUser = Effect.fn('selectSessionUser')(function* (
  token: Option.Option<Redacted.Redacted<string>>
) {
  if (Option.isNone(token) || Redacted.value(token.value) === '')
    return Option.none<CurrentUser['Service']>();
  const accounts = yield* Accounts;
  const crypto = yield* CloudCrypto;
  const user = yield* accounts.selectSessionUser(yield* crypto.hashToken(token.value));
  return Option.map(user, asCurrentUser);
});

export const selectRequestUser = Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
  selectSessionUser(selectSessionToken(request))
);

export const assertPageRequest = Effect.fn('assertPageRequest')(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (SAFE_METHODS.has(request.method) || Option.isSome(selectBearer(request))) return;
  const { origin } = yield* CloudConfig;
  if (request.headers.origin !== origin)
    return yield* new Forbidden({ message: 'Requests from other sites are not allowed.' });
});

export const createSession = Effect.fn('createSession')(function* (userId: RemoteUserId) {
  const crypto = yield* CloudCrypto;
  const accounts = yield* Accounts;
  const token = yield* crypto.createToken();
  const expiresAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(SESSION_TTL);
  yield* accounts.createSession(yield* crypto.hashToken(token), userId, expiresAt);
  return token;
});
