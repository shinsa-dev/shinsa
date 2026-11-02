import { REMOTE_SESSION_COOKIE, type RemoteUser, RemoteUserId } from '@shinsa/core';
import { CurrentMachine, CurrentUser, MachineSession, PageSession } from '@shinsa/core/remote/api';
import { Forbidden, Revoked, SignedOut } from '@shinsa/core/remote/errors';
import { Effect, Layer, Option, Redacted } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { CloudConfig } from '../config/config.ts';
import { CloudCrypto } from '../crypto/crypto.ts';
import { Accounts } from '../store/accounts.ts';
import { Machines } from '../store/machines.ts';

const BEARER = 'Bearer ';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function selectBearer(request: HttpServerRequest.HttpServerRequest) {
  const header = request.headers.authorization ?? '';
  return header.startsWith(BEARER) ? Option.some(Redacted.make(header.slice(BEARER.length))) : Option.none();
}

export function selectSessionToken(request: HttpServerRequest.HttpServerRequest) {
  return Option.orElse(selectBearer(request), () =>
    Option.map(Option.fromNullishOr(request.cookies[REMOTE_SESSION_COOKIE]), (token) => Redacted.make(token))
  );
}

export const asCurrentUser = (user: RemoteUser) => ({ ...user, id: RemoteUserId.make(user.id) });

const selectSessionUser = Effect.fn('selectSessionUser')(function* (
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

const signedOut = () => new SignedOut({ message: 'Sign in with GitHub first.' });

export const PageSessionLive = Layer.effect(
  PageSession,
  Effect.gen(function* () {
    const services = yield* Effect.context<Accounts | CloudCrypto | CloudConfig>();

    const findUser = Effect.fn('PageSession.findUser')(function* (token: Redacted.Redacted<string>) {
      const user = yield* selectSessionUser(Option.some(token));
      if (Option.isNone(user)) return yield* signedOut();
      return user.value;
    }, Effect.provideContext(services));

    return PageSession.of({
      bearer: Effect.fn('PageSession.bearer')(function* (httpEffect, { credential }) {
        const user = yield* findUser(credential);
        return yield* Effect.provideService(httpEffect, CurrentUser, user);
      }),
      cookie: Effect.fn('PageSession.cookie')(function* (httpEffect, { credential }) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (Option.isSome(selectBearer(request))) return yield* signedOut();
        yield* Effect.provideContext(assertPageRequest(), services);
        const user = yield* findUser(credential);
        return yield* Effect.provideService(httpEffect, CurrentUser, user);
      }),
    });
  })
);

export const MachineSessionLive = Layer.effect(
  MachineSession,
  Effect.gen(function* () {
    const machines = yield* Machines;
    const crypto = yield* CloudCrypto;

    return MachineSession.of({
      bearer: Effect.fn('MachineSession.bearer')(function* (httpEffect, { credential }) {
        const revoked = new Revoked({ message: 'This machine is not paired.' });
        if (Redacted.value(credential) === '') return yield* revoked;
        const machine = yield* machines.selectByToken(yield* crypto.hashToken(credential));
        if (Option.isNone(machine)) return yield* revoked;
        return yield* Effect.provideService(httpEffect, CurrentMachine, {
          instanceId: machine.value.id,
          ownerId: machine.value.userId,
        });
      }),
    });
  })
);
