import { EngineGate } from '@shinsa/core/engine-api';
import {
  BodyTooLarge,
  BrowserOnlyRoute,
  ContentTypeInvalid,
  RequestBodyLimit,
  RequestFailed,
  RouteFieldFailures,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
} from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Schema, SchemaIssue } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { type HttpApiEndpoint, HttpApiError } from 'effect/http-api';
import { TunnelGate } from '../../remote/gate/service.ts';
import { resolveRequestFailure } from '../failures.ts';
import { describeBodyLimit, resolveBodyRefusal, resolveBodySizeRefusal } from '../guard.ts';
import {
  BODY_INVALID,
  BODY_NOT_JSON,
  BODY_NOT_OBJECT,
  BROWSER_ONLY,
  READ_METHODS,
  RequestSource,
} from '../schema.ts';
import type { GateError } from './schema.ts';

export const EngineGateLive = Layer.effect(
  EngineGate,
  Effect.gen(function* () {
    const gate = yield* TunnelGate;
    const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();
    const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

    const assertScope = Effect.fn('EngineGate.assertScope')(function* (endpoint: HttpApiEndpoint.Top) {
      const source = yield* RequestSource;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const pathname = new URL(request.originalUrl).pathname;
      yield* gate.admitEndpoint(endpoint.annotations, { method: request.method, pathname }, source);
    });

    const acceptsNoBody = (endpoint: HttpApiEndpoint.Top) =>
      [...endpoint.payload.values()].some((entry) =>
        entry.schemas.some((schema) => Schema.is(Schema.toType(schema))(null))
      );

    const assertBody = Effect.fn('EngineGate.assertBody')(function* (endpoint: HttpApiEndpoint.Top) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (READ_METHODS.has(request.method)) return;
      const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
      const typeRefusal = resolveBodyRefusal(web);
      if (typeRefusal) return yield* new ContentTypeInvalid({ message: typeRefusal });
      const limit = Context.get(endpoint.annotations, RequestBodyLimit);
      const sizeRefusal = resolveBodySizeRefusal(web, limit);
      if (sizeRefusal) return yield* new BodyTooLarge({ message: sizeRefusal });
      const browserOnly = Context.get(endpoint.annotations, BrowserOnlyRoute);
      const source = yield* RequestSource;
      if (browserOnly && source.via !== 'channel' && request.headers.origin === undefined)
        return yield* new RequestFailed({ code: BROWSER_ONLY, message: browserOnly });
      if (endpoint.payload.size === 0) return;
      const bytes = yield* Effect.orDie(request.arrayBuffer);
      if (bytes.byteLength > limit)
        return yield* new RequestFailed({ code: 'body_too_large', message: describeBodyLimit(limit) });
      if (bytes.byteLength === 0 && acceptsNoBody(endpoint)) return;
      yield* decodeJson(new TextDecoder().decode(bytes)).pipe(
        Effect.mapError(() => new RequestFailed({ code: BODY_INVALID, message: BODY_NOT_JSON }))
      );
    });

    const mapSchemaError = (
      endpoint: HttpApiEndpoint.Top,
      error: HttpApiError.HttpApiSchemaError
    ): Effect.Effect<never, RequestFailed | RouteNotFound> => {
      if (error.kind === 'Params')
        return Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
      if (error.kind !== 'Payload' && error.kind !== 'Query' && error.kind !== 'Headers')
        return Effect.die(error);
      const [first] = formatIssues(error.cause.issue).issues;
      const field = String(first?.path?.[0] ?? '');
      const failure = Context.get(endpoint.annotations, RouteFieldFailures)[field];
      if (failure) return Effect.fail(new RequestFailed(failure));
      if (field === '')
        return Effect.fail(new RequestFailed({ code: BODY_INVALID, message: BODY_NOT_OBJECT }));
      return Effect.fail(
        new RequestFailed({
          code: BODY_INVALID,
          message: `The field ${field} is not valid: ${first?.message ?? error.message}.`,
        })
      );
    };

    const recordFailure = Effect.fn('EngineGate.recordFailure')(function* (error: RequestFailed) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* Effect.logWarning('[Server] Request failed').pipe(
        Effect.annotateLogs({ path: new URL(request.originalUrl).pathname, error: error.message })
      );
    });

    return (httpEffect, { endpoint }) =>
      Effect.andThen(Effect.andThen(assertScope(endpoint), assertBody(endpoint)), httpEffect).pipe(
        Effect.catchDefect((defect) => Effect.fail(resolveRequestFailure(defect))),
        Effect.catch((error: GateError): Effect.Effect<never, GateError> =>
          HttpApiError.HttpApiSchemaError.is(error) ? mapSchemaError(endpoint, error) : Effect.fail(error)
        ),
        Effect.tapError((error) => (Schema.is(RequestFailed)(error) ? recordFailure(error) : Effect.void))
      );
  })
);
