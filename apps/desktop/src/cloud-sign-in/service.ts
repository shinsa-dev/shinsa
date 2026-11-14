import { REMOTE_PATHS, REMOTE_SESSION_COOKIE, serializeBase64Url } from '@shinsa/core';
import { RemoteApi } from '@shinsa/core/remote/api';
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Ref } from 'effect';
import { HttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { DesktopHost } from '../host/service.ts';
import { SessionCookies } from '../session-cookies/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { resolveCloudOrigin } from '../source/source.ts';
import { AppWindow } from '../window/service.ts';
import { parseSignInReturn, resolveSignInFailurePath, resolveSignInUrl } from './link.ts';
import {
  SESSION_COOKIE_TTL,
  SIGN_IN_FAILURE,
  SignInExchangeFailed,
  type SignInReturn,
  VERIFIER_BYTES,
} from './schema.ts';

export class CloudSignIn extends Context.Service<
  CloudSignIn,
  {
    readonly start: Effect.Effect<void>;
    finish(link: string): Effect.Effect<boolean>;
  }
>()('shinsa/desktop/cloud-sign-in/CloudSignIn') {
  static readonly layer = Layer.effect(
    CloudSignIn,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const shell = yield* DesktopShell;
      const window = yield* AppWindow;
      const cookies = yield* SessionCookies;
      const origin = resolveCloudOrigin(host.env);
      const session = yield* HttpApiClient.group(RemoteApi, {
        httpClient: yield* HttpClient.HttpClient,
        baseUrl: origin,
        group: 'session',
      });
      const createVerifier = Effect.sync(() =>
        Redacted.make(serializeBase64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES))))
      );

      const createChallenge = (verifier: Redacted.Redacted<string>) =>
        Effect.map(
          Effect.promise(() =>
            crypto.subtle.digest('SHA-256', new TextEncoder().encode(Redacted.value(verifier)))
          ),
          (digest) => serializeBase64Url(new Uint8Array(digest))
        );
      const pending = yield* Ref.make(Option.none<Redacted.Redacted<string>>());
      const exchange = Effect.fn('CloudSignIn.exchange')(function* (
        code: string,
        verifier: Redacted.Redacted<string>
      ) {
        const answer = yield* session
          .signInToken({ payload: { code, codeVerifier: Redacted.value(verifier) } })
          .pipe(Effect.mapError(() => new SignInExchangeFailed({ origin })));
        const now = yield* Clock.currentTimeMillis;
        yield* cookies.write({
          url: origin,
          name: REMOTE_SESSION_COOKIE,
          value: answer.token,
          expiresAt: Math.floor((now + Duration.toMillis(SESSION_COOKIE_TTL)) / 1000),
        });
      });
      const resolveLanding = Effect.fn('CloudSignIn.resolveLanding')(function* (back: SignInReturn) {
        if (back._tag === 'Failed') return resolveSignInFailurePath(back.code);
        const verifier = yield* Ref.getAndSet(pending, Option.none());
        if (Option.isNone(verifier)) return resolveSignInFailurePath(SIGN_IN_FAILURE.expired);
        return yield* exchange(back.code, verifier.value).pipe(
          Effect.as(REMOTE_PATHS.app),
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning('[Desktop] Signing in to Shinsa Cloud failed').pipe(
                Effect.annotateLogs({ error: error._tag })
              ),
              resolveSignInFailurePath(SIGN_IN_FAILURE.failed)
            )
          )
        );
      });
      return CloudSignIn.of({
        start: Effect.gen(function* () {
          const verifier = yield* createVerifier;
          yield* Ref.set(pending, Option.some(verifier));
          yield* shell.openExternal(resolveSignInUrl(origin, yield* createChallenge(verifier)));
        }).pipe(Effect.withSpan('CloudSignIn.start')),
        finish: Effect.fn('CloudSignIn.finish')(function* (link: string) {
          const back = parseSignInReturn(link);
          if (Option.isNone(back)) return false;
          yield* window.load(yield* resolveLanding(back.value));
          yield* window.show;
          return true;
        }),
      });
    })
  );
}
