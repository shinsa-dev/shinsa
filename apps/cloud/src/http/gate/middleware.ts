import { BodyLimit, RequestGate } from '@shinsa/core/remote/api';
import {
  BodyInvalid,
  BodyTooLarge,
  ContentTypeInvalid,
  NotFound,
  serializeRemoteFailure,
} from '@shinsa/core/remote/errors';
import { Context, Effect, Layer, Predicate, type Schema, SchemaIssue } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { type HttpApiEndpoint, HttpApiError } from 'effect/http-api';
import { type GateError, JSON_CONTENT_TYPE } from './schema.ts';

export const RequestGateLive = Layer.sync(RequestGate, () => {
  const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

  const describeSchemaError = (error: Schema.SchemaError) => {
    const [first] = formatIssues(error.issue).issues;
    const field = first?.path?.join('.') ?? '';
    const subject = field === '' ? 'The request body' : `The field ${field}`;
    return `${subject} is not valid: ${first?.message ?? error.message}.`;
  };

  const schemaFailures: Partial<
    Record<
      HttpApiError.HttpApiSchemaError['kind'],
      (error: HttpApiError.HttpApiSchemaError) => NotFound | BodyInvalid
    >
  > = {
    Params: () => new NotFound({ message: 'No such endpoint.' }),
    Payload: (error) => new BodyInvalid({ message: describeSchemaError(error.cause) }),
  };

  const mapSchemaError = (
    error: HttpApiError.HttpApiSchemaError
  ): Effect.Effect<never, NotFound | BodyInvalid> => {
    const failure = schemaFailures[error.kind];
    return failure ? Effect.fail(failure(error)) : Effect.die(error);
  };

  const assertBody = Effect.fn('RequestGate.assertBody')(function* (endpoint: HttpApiEndpoint.Top) {
    if (endpoint.payload.size === 0) return;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const contentType = (request.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith(JSON_CONTENT_TYPE))
      return yield* new ContentTypeInvalid({ message: 'Send the request body as application/json.' });
    const body = yield* Effect.orDie(request.text);
    if (body.length > Context.get(endpoint.annotations, BodyLimit))
      return yield* new BodyTooLarge({ message: 'The request body is too large.' });
  });

  const recordServerFailure = (error: GateError) => {
    if (!Predicate.hasProperty(error, '_tag') || !Predicate.hasProperty(error, 'message')) return Effect.void;
    const { status, body } = serializeRemoteFailure({
      _tag: String(error._tag),
      message: String(error.message),
    });
    if (status < 500) return Effect.void;
    return Effect.logError('[Cloud] Request failed').pipe(Effect.annotateLogs(body.error));
  };

  return (httpEffect, { endpoint }) =>
    Effect.catch(
      Effect.andThen(assertBody(endpoint), httpEffect),
      (error: GateError): Effect.Effect<never, GateError> =>
        HttpApiError.HttpApiSchemaError.is(error) ? mapSchemaError(error) : Effect.fail(error)
    ).pipe(Effect.tapError(recordServerFailure));
});
