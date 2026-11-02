import { EngineApi } from '@shinsa/core/engine-api';
import { EditConflict } from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Option, Predicate } from 'effect';
import { HttpClient, type HttpClientResponse, HttpIncomingMessage } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
import {
  ENGINE_ANSWER_UNREADABLE_MESSAGE,
  ENGINE_UNREACHABLE_MESSAGE,
  EngineAnswerInvalid,
  EngineErrorBody,
  type EngineFailure,
  EngineReadOnly,
  EngineRefused,
  EngineUnreachable,
  REQUEST_FAILED_CODE,
} from './schema.ts';

export class EngineClient extends Context.Service<
  EngineClient,
  HttpApiClient.ForApi<typeof EngineApi, EngineFailure>
>()('shinsa/web/runtime/engine/EngineClient') {
  static readonly layer = Layer.effect(
    EngineClient,
    Effect.gen(function* () {
      const decodeRefusal = HttpIncomingMessage.schemaBodyJson(EngineErrorBody);
      const unreachable = new EngineUnreachable({ message: ENGINE_UNREACHABLE_MESSAGE });
      const unreadable = new EngineAnswerInvalid({ message: ENGINE_ANSWER_UNREADABLE_MESSAGE });
      const refuse = (response: HttpClientResponse.HttpClientResponse) =>
        decodeRefusal(response).pipe(
          Effect.option,
          Effect.flatMap((body) =>
            Effect.fail(
              new EngineRefused({
                status: response.status,
                code: Option.match(body, {
                  onNone: () => REQUEST_FAILED_CODE,
                  onSome: ({ error }) => error.code ?? REQUEST_FAILED_CODE,
                }),
                message: Option.match(body, {
                  onNone: () => `Shinsa answered with status ${response.status}.`,
                  onSome: ({ error }) => error.message,
                }),
              })
            )
          )
        );
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.transform(
          Effect.fnUntraced(function* (sent, request) {
            if (request.method !== 'GET' && selectReadOnlyRefusal() !== null)
              return yield* new EngineReadOnly({ message: READ_ONLY_REFUSAL });
            const response = yield* Effect.mapError(sent, () => unreachable);
            if (response.status < 400 || response.status === EditConflict.status) return response;
            return yield* refuse(response);
          })
        )
      );
      return yield* HttpApiClient.makeWith(EngineApi, {
        httpClient,
        transformResponse: Effect.mapError((error) =>
          Predicate.isTagged(error, 'SchemaError') || Predicate.isTagged(error, 'HttpClientError')
            ? unreadable
            : error
        ),
      });
    })
  );
}
