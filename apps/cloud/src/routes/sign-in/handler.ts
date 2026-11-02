import {
  decodeText,
  encodeText,
  isSameSecret,
  parseBase64Url,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
  REMOTE_SESSION_COOKIE,
  RemoteUserId,
  serializeBase64Url,
} from '@shinsa/core';
import { InvalidChallenge, InvalidRedirect, SignInFailed } from '@shinsa/core/remote/errors';
import { Cause, Clock, Duration, Effect, Layer, Option, Redacted, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';
import { SESSION_TTL, SIGN_IN_EXPIRED } from '../../auth/schema.ts';
import { createSession } from '../../auth/tokens.ts';
import { CloudConfig } from '../../config/service.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { serializeCookie, serializeExpiredCookie } from '../../http/cookies.ts';
import { CurrentUrl, readCookie } from '../../http/request.ts';
import { resolveFailureCode, respondFailure, respondRedirect } from '../../http/responses.ts';
import { GitHub } from '../../integrations/github/service.ts';
import { Accounts } from '../../store/accounts/service.ts';
import {
  CODE_CHALLENGE_PATTERN,
  GITHUB_AUTHORIZE,
  NATIVE_REDIRECT_LIMIT,
  type NativeSignIn,
  OAUTH_COOKIE,
  OAUTH_TTL,
  OAuthCookie,
  SIGN_IN_CODE_TTL,
} from './schema.ts';

export const SignInRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* CloudConfig;
    const crypto = yield* CloudCrypto;
    const github = yield* GitHub;
    const accounts = yield* Accounts;
    const decodeOAuthCookie = Schema.decodeUnknownOption(OAuthCookie);
    const encodeOAuthCookie = Schema.encodeSync(OAuthCookie);
    const decodeUserId = Schema.decodeEffect(RemoteUserId);

    const selectNativeRedirect = (value: string | null) => {
      if (!value || value.length > NATIVE_REDIRECT_LIMIT || !URL.canParse(value)) return null;
      const url = new URL(value);
      return REMOTE_NATIVE_REDIRECT_SCHEMES.some((scheme) => scheme === url.protocol) ? url.toString() : null;
    };

    const resolveNative = (native: NativeSignIn | null | undefined): NativeSignIn | null => {
      const redirect = native ? selectNativeRedirect(native.redirect) : null;
      const challenge = native && CODE_CHALLENGE_PATTERN.test(native.challenge) ? native.challenge : null;
      return redirect && challenge ? { redirect, challenge } : null;
    };

    const resolveReturnPath = (value: string | null | undefined) => {
      if (!value?.startsWith('/') || !URL.canParse(value, config.origin)) return REMOTE_PATHS.app;
      const url = new URL(value, config.origin);
      return url.origin === config.origin ? `${url.pathname}${url.search}` : REMOTE_PATHS.app;
    };

    const readOAuthState = (request: HttpServerRequest.HttpServerRequest) => {
      const bytes = parseBase64Url(readCookie(request, OAUTH_COOKIE) ?? '');
      return Option.map(decodeOAuthCookie(bytes ? decodeText(bytes) : ''), (fields) => ({
        state: fields.state,
        verifier: fields.verifier,
        returnPath: fields.returnPath ?? REMOTE_PATHS.app,
        native: resolveNative(fields.native),
      }));
    };

    const resolveNativeLocation = (redirect: string, name: string, value: string) => {
      const location = new URL(redirect);
      location.searchParams.set(name, value);
      return location.toString();
    };

    const resolveNativeRequest = Effect.fn('signIn.resolveNativeRequest')(function* (url: URL) {
      if (url.searchParams.get('client') !== REMOTE_NATIVE_CLIENT) return null;
      const redirect = selectNativeRedirect(url.searchParams.get('redirect'));
      if (!redirect)
        return yield* new InvalidRedirect({
          message: 'The app can only be sent back to a shinsa:// address.',
        });
      const challenge = url.searchParams.get('code_challenge') ?? '';
      const method = url.searchParams.get('code_challenge_method') ?? 'S256';
      if (method !== 'S256' || !CODE_CHALLENGE_PATTERN.test(challenge))
        return yield* new InvalidChallenge({ message: 'Send an S256 code challenge with the sign-in.' });
      return { redirect, challenge } satisfies NativeSignIn;
    });

    const respondSignIn = Effect.gen(function* () {
      const url = yield* CurrentUrl;
      const native = yield* resolveNativeRequest(url);
      const state = Redacted.value(yield* crypto.createToken(24));
      const verifier = yield* crypto.createToken(32);
      const authorize = new URL(GITHUB_AUTHORIZE);
      authorize.searchParams.set('client_id', config.githubClientId);
      authorize.searchParams.set('redirect_uri', `${config.origin}${REMOTE_PATHS.signInCallback}`);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', yield* crypto.createCodeChallenge(verifier));
      authorize.searchParams.set('code_challenge_method', 'S256');
      authorize.searchParams.set('allow_signup', 'false');
      const cookie = serializeBase64Url(
        encodeText(
          encodeOAuthCookie({
            state,
            verifier: Redacted.value(verifier),
            returnPath: resolveReturnPath(url.searchParams.get('return')),
            native,
          })
        )
      );
      return respondRedirect(authorize.toString(), {
        cookies: [serializeCookie(OAUTH_COOKIE, cookie, OAUTH_TTL)],
      });
    }).pipe(Effect.catchTags({ InvalidRedirect: respondFailure, InvalidChallenge: respondFailure }));

    const respondNativeCallback = Effect.fn('signIn.respondNativeCallback')(function* (
      userId: RemoteUserId,
      native: NativeSignIn
    ) {
      const code = yield* crypto.createToken();
      yield* accounts.createSignInCode(yield* crypto.hashToken(code), {
        userId,
        codeChallenge: native.challenge,
        expiresAt: (yield* Clock.currentTimeMillis) + Duration.toMillis(SIGN_IN_CODE_TTL),
      });
      return respondRedirect(resolveNativeLocation(native.redirect, 'code', Redacted.value(code)), {
        cookies: [serializeExpiredCookie(OAUTH_COOKIE)],
      });
    });

    const respondCallback = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = yield* CurrentUrl;
      const oauth = readOAuthState(request);
      const code = url.searchParams.get('code');
      if (
        Option.isNone(oauth) ||
        !code ||
        !isSameSecret(oauth.value.state, url.searchParams.get('state') ?? '')
      )
        return yield* new SignInFailed({ message: SIGN_IN_EXPIRED });
      const user = yield* github.signIn(code, Redacted.make(oauth.value.verifier));
      yield* accounts.upsertUser(user);
      const userId = yield* decodeUserId(user.id).pipe(Effect.orDie);
      if (oauth.value.native) return yield* respondNativeCallback(userId, oauth.value.native);
      const token = yield* createSession(userId);
      return respondRedirect(resolveReturnPath(oauth.value.returnPath), {
        cookies: [
          serializeCookie(REMOTE_SESSION_COOKIE, Redacted.value(token), SESSION_TTL),
          serializeExpiredCookie(OAUTH_COOKIE),
        ],
      });
    });

    const respondCallbackFailure = Effect.fn('signIn.respondCallbackFailure')(function* (
      cause: Cause.Cause<SignInFailed>
    ) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const failure = Cause.findErrorOption(cause);
      if (Option.isNone(failure))
        yield* Effect.logError('[Cloud] Request failed').pipe(
          Effect.annotateLogs({ cause: Cause.pretty(cause) })
        );
      const errorCode = Option.match(failure, { onNone: () => 'server_error', onSome: resolveFailureCode });
      const native = Option.flatMapNullishOr(readOAuthState(request), (oauth) => oauth.native);
      const location = Option.match(native, {
        onNone: () => `${REMOTE_PATHS.app}?sign_in_error=${encodeURIComponent(errorCode)}`,
        onSome: (sign) => resolveNativeLocation(sign.redirect, 'error', errorCode),
      });
      return respondRedirect(location);
    });

    return Layer.mergeAll(
      HttpRouter.add('GET', REMOTE_PATHS.signIn, respondSignIn),
      HttpRouter.add(
        'GET',
        REMOTE_PATHS.signInCallback,
        respondCallback.pipe(Effect.catchCause(respondCallbackFailure))
      )
    );
  })
);
