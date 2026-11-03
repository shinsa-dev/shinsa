import { SCOPE_MESSAGES } from '@shinsa/core';
import { ENGINE_BODY_LIMIT_BYTES } from '@shinsa/core/engine-api/schema';
import {
  BodyTooLarge,
  ContentTypeInvalid,
  InspectReadOnly,
  RequestFailed,
  RequestForbidden,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Cause, Effect, Option, Predicate, Schema, type Types } from 'effect';
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { INSPECT_MESSAGE } from '../../instance/index.ts';
import { describeError } from '../../log/index.ts';
import { TunnelGate } from '../../remote/gate/service.ts';
import { isWebhookPath } from '../../schedules/webhook.ts';
import {
  resolveAllowedHosts,
  resolveBodyRefusal,
  resolveBodySizeRefusal,
  resolveHostRefusal,
  resolveRefusal,
} from '../guard.ts';
import { respondFailure } from '../responses.ts';
import { IngressFailure, REQUEST_FAILED, RequestSource, type RequestSourceShape } from '../schema.ts';
import { HttpServices } from '../services/service.ts';
import { serveStatic } from '../static.ts';

export const Ingress = HttpRouter.middleware(
  Effect.gen(function* () {
    const services = yield* HttpServices;
    const { config, extensions } = services;
    const gate = yield* TunnelGate;
    const allowedHosts = resolveAllowedHosts(config.allowedHosts);
    const isIngressFailure = Schema.is(IngressFailure);
    const notFound = () => new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });

    const isNoRoute = (error: unknown) =>
      (HttpServerError.isHttpServerError(error) && error.reason._tag === 'RouteNotFound') ||
      Predicate.isTagged(error, 'RouteNotFound');

    const assertWritable = () =>
      config.inspect ? Effect.fail(new InspectReadOnly({ message: INSPECT_MESSAGE })) : Effect.void;

    const resolveVia = (web: Request, source: RequestSourceShape): RequestSourceShape => {
      if (source.via !== 'local' || !gate.isTunnel(web)) return source;
      return { via: 'tunnel', guest: null, userId: null };
    };

    const respondPage = (pathname: string) =>
      Effect.map(serveStatic(config.webDir, pathname), HttpServerResponse.raw);

    const respondMissing = Effect.fn('Ingress.respondMissing')(function* (
      web: Request,
      url: URL,
      source: RequestSourceShape
    ) {
      if (source.via === 'tunnel') return yield* notFound();
      if (source.guest) return yield* new ScopeRefused({ message: SCOPE_MESSAGES.task });
      if (!url.pathname.startsWith('/api/'))
        return yield* source.via === 'local' ? respondPage(url.pathname) : notFound();
      const typeRefusal = resolveBodyRefusal(web);
      if (typeRefusal) return yield* new ContentTypeInvalid({ message: typeRefusal });
      const sizeRefusal = resolveBodySizeRefusal(web, ENGINE_BODY_LIMIT_BYTES);
      if (sizeRefusal) return yield* new BodyTooLarge({ message: sizeRefusal });
      return yield* notFound();
    });

    const respondCause = Effect.fn('Ingress.respondCause')(function* (
      cause: Cause.Cause<unknown>,
      web: Request,
      url: URL,
      source: RequestSourceShape
    ) {
      const failure = Cause.findErrorOption(cause);
      if (Option.isSome(failure) && isNoRoute(failure.value))
        return yield* respondMissing(web, url, source).pipe(Effect.catch(respondFailure));
      if (Option.isSome(failure) && isIngressFailure(failure.value))
        return yield* respondFailure(failure.value);
      const defect = Cause.squash(cause);
      const message = describeError(
        Predicate.hasProperty(defect, 'message') && Predicate.isString(defect.message)
          ? defect.message
          : defect
      );
      yield* Effect.logWarning('[Server] Request failed').pipe(
        Effect.annotateLogs({ path: url.pathname, error: message })
      );
      return yield* respondFailure(new RequestFailed({ code: REQUEST_FAILED, message }));
    });

    const admitLocal = Effect.fn('Ingress.admitLocal')(function* (web: Request, url: URL) {
      yield* gate.admitRequest(web, url, { via: 'local', guest: null, userId: null });
      if (isWebhookPath(url.pathname)) return yield* assertWritable();
      if (web.method === 'GET' && extensions?.isCallback(url.pathname)) {
        yield* assertWritable();
        const hostRefusal = resolveHostRefusal(web, allowedHosts);
        if (hostRefusal) return yield* new RequestForbidden({ message: hostRefusal });
        return;
      }
      const refusal = resolveRefusal(web, allowedHosts);
      if (refusal) return yield* new RequestForbidden({ message: refusal });
      if (url.pathname.startsWith('/api/') && web.method !== 'GET') yield* assertWritable();
    });

    const admit = Effect.fn('Ingress.admit')(function* (web: Request, url: URL, source: RequestSourceShape) {
      if (source.via === 'local') return yield* admitLocal(web, url);
      return yield* gate.admitRequest(web, url, source);
    });

    return Effect.fn('Ingress')(function* (
      httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>
    ): Effect.fn.Return<
      HttpServerResponse.HttpServerResponse,
      Types.unhandled,
      HttpServerRequest.HttpServerRequest
    > {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
      const url = new URL(request.originalUrl);
      const source = resolveVia(web, yield* RequestSource);
      return yield* Effect.andThen(admit(web, url, source), httpEffect).pipe(
        Effect.provideService(RequestSource, source),
        Effect.catchCause((cause) => respondCause(cause, web, url, source))
      );
    });
  }),
  { global: true }
);
