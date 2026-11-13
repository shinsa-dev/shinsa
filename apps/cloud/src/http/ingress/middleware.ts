import { RELAY_PATH_PREFIX, REMOTE_PATHS } from '@shinsa/core';
import { MethodNotAllowed, NotFound, SERVER_ERROR_MESSAGE, ServerError } from '@shinsa/core/remote/errors';
import { Cause, Effect, Option, Predicate, type Types } from 'effect';
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { CloudConfig } from '../../config/service.ts';
import { isPreviewHost } from '../../routes/previews/address.ts';
import { PreviewHost } from '../../routes/previews/service.ts';
import { NOINDEX, respondFailure } from '../responses.ts';
import { Assets } from '../worker.ts';
import { API_PREFIX, HOOKS_PREFIX, PAGE_METHODS, SECURITY_HEADERS } from './schema.ts';

export const Ingress = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* CloudConfig;
    const previews = yield* PreviewHost;

    const isUnlistedPage = (pathname: string) =>
      pathname.startsWith(`${REMOTE_PATHS.sharePage}/`) || pathname === REMOTE_PATHS.teamJoinPage;

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

    const respondPreview = (url: URL) =>
      previews
        .respond(url)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.map(respondCause(cause, url), (answer) =>
              HttpServerResponse.setHeader(answer, 'x-robots-tag', NOINDEX)
            )
          )
        );

    return Effect.fn('Ingress')(function* (
      httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>
    ): Effect.fn.Return<
      HttpServerResponse.HttpServerResponse,
      Types.unhandled,
      HttpServerRequest.HttpServerRequest | Assets
    > {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.originalUrl);
      if (isPreviewHost(url.host, config.previewOrigin)) return yield* respondPreview(url);
      const response = yield* httpEffect.pipe(Effect.catchCause((cause) => respondCause(cause, url)));
      return url.pathname.startsWith(HOOKS_PREFIX) || url.pathname.startsWith(RELAY_PATH_PREFIX)
        ? response
        : HttpServerResponse.setHeaders(response, SECURITY_HEADERS);
    });
  }),
  { global: true }
);
