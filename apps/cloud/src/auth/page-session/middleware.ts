import { CurrentUser, PageSession } from '@shinsa/core/remote/api';
import { SignedOut } from '@shinsa/core/remote/errors';
import { Effect, Layer, Option, type Redacted } from 'effect';
import { HttpServerRequest } from 'effect/http';
import type { CloudConfig } from '../../config/service.ts';
import type { CloudCrypto } from '../../crypto/service.ts';
import type { Accounts } from '../../store/accounts/service.ts';
import { assertPageRequest, selectBearer, selectSessionUser } from '../tokens.ts';

export const PageSessionLive = Layer.effect(
  PageSession,
  Effect.gen(function* () {
    const services = yield* Effect.context<Accounts | CloudCrypto | CloudConfig>();

    const signedOut = () => new SignedOut({ message: 'Sign in with GitHub first.' });

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
