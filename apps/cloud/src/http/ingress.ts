import { REMOTE_PATHS } from '@shinsa/core';
import { MethodNotAllowed, NotFound, SERVER_ERROR_MESSAGE, ServerError } from '@shinsa/core/remote/errors';
import { Cause, Effect, Option, Predicate, type Types } from 'effect';
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { CloudConfig } from '../config/config.ts';
import { isPreviewHost, respondPreviewHost } from '../routes/previews.ts';
import { NOINDEX, respondFailure } from './responses.ts';
import { Assets } from './worker.ts';

const API_PREFIX = '/__remote/';

const HOOKS_PREFIX = '/hooks/';

const PAGE_METHODS = new Set(['GET', 'HEAD']);

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' blob: wss://*.shinsa.dev",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://github.com",
    "object-src 'none'",
  ].join('; '),
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

function isUnlistedPage(pathname: string) {
  return pathname.startsWith(`${REMOTE_PATHS.sharePage}/`) || pathname === REMOTE_PATHS.teamJoinPage;
}

const isRouteNotFound = (error: unknown) =>
  HttpServerError.isHttpServerError(error) && error.reason._tag === 'RouteNotFound';

const isRemoteFailure = (error: unknown): error is { readonly _tag: string; readonly message: string } =>
  Predicate.hasProperty(error, '_tag') &&
  Predicate.isString(error._tag) &&
  Predicate.hasProperty(error, 'message') &&
  Predicate.isString(error.message);

const respondPage = Effect.fn('Ingress.respondPage')(function* (url: URL) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (url.pathname.startsWith(API_PREFIX))
    return yield* respondFailure(new NotFound({ message: 'No such endpoint.' }));
  if (!PAGE_METHODS.has(request.method))
    return yield* respondFailure(new MethodNotAllowed({ message: 'Only GET is served here.' }));
  const assets = yield* Assets;
  const page = yield* Effect.flatMap(Effect.orDie(HttpServerRequest.toWeb(request)), (web) =>
    Effect.promise(() => assets.fetch(web))
  );
  const response = HttpServerResponse.raw(page);
  return isUnlistedPage(url.pathname)
    ? HttpServerResponse.setHeader(response, 'x-robots-tag', NOINDEX)
    : response;
});

const respondCause = Effect.fn('Ingress.respondCause')(function* (cause: Cause.Cause<unknown>, url: URL) {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure) && isRouteNotFound(failure.value)) return yield* respondPage(url);
  const known = Option.filter(failure, isRemoteFailure);
  const answer = yield* respondFailure(
    Option.getOrElse(known, () => new ServerError({ message: SERVER_ERROR_MESSAGE }))
  );
  if (answer.status >= 500)
    yield* Effect.logError('[Cloud] Request failed').pipe(
      Effect.annotateLogs({ cause: Cause.pretty(cause) })
    );
  return answer;
});

function applySecurityHeaders(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.setHeaders(response, SECURITY_HEADERS);
}

const respondPreview = (url: URL) =>
  respondPreviewHost(url).pipe(
    Effect.catchCause((cause) =>
      Effect.map(respondCause(cause, url), (answer) =>
        HttpServerResponse.setHeader(answer, 'x-robots-tag', NOINDEX)
      )
    )
  );

type IngressServices =
  | HttpServerRequest.HttpServerRequest
  | Effect.Services<ReturnType<typeof respondPreview>>
  | Effect.Services<ReturnType<typeof respondCause>>;

export const Ingress = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* CloudConfig;
    return Effect.fn('Ingress')(function* (
      httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>
    ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, Types.unhandled, IngressServices> {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.originalUrl);
      if (isPreviewHost(url.host, config.previewOrigin)) return yield* respondPreview(url);
      const response = yield* httpEffect.pipe(Effect.catchCause((cause) => respondCause(cause, url)));
      return url.pathname.startsWith(HOOKS_PREFIX) ? response : applySecurityHeaders(response);
    });
  }),
  { global: true }
);
