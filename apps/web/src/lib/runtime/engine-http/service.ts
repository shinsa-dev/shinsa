import { EditConflict } from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Option } from 'effect';
import { HttpClient, type HttpClientError, type HttpClientResponse, HttpIncomingMessage } from 'effect/http';
import { READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
import {
  ENGINE_UNREACHABLE_MESSAGE,
  EngineErrorBody,
  type EngineHttpFailure,
  EngineReadOnly,
  EngineRefused,
  EngineUnreachable,
  REQUEST_FAILED_CODE,
} from '../engine/schema.ts';

export class EngineHttp extends Context.Service<
  EngineHttp,
  HttpClient.HttpClient.With<EngineHttpFailure | HttpClientError.HttpClientError>
>()('shinsa/web/runtime/engine-http/EngineHttp') {
  static readonly layer = Layer.effect(
    EngineHttp,
    Effect.gen(function* () {
      const decodeRefusal = HttpIncomingMessage.schemaBodyJson(EngineErrorBody);
      const unreachable = new EngineUnreachable({ message: ENGINE_UNREACHABLE_MESSAGE });
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
      const isConflict = (response: HttpClientResponse.HttpClientResponse) =>
        decodeRefusal(response).pipe(
          Effect.map(({ error }) => error.code === EditConflict.code),
          Effect.orElseSucceed(() => false)
        );
      return (yield* HttpClient.HttpClient).pipe(
        HttpClient.transform(
          Effect.fnUntraced(function* (sent, request) {
            if (request.method !== 'GET' && selectReadOnlyRefusal() !== null)
              return yield* new EngineReadOnly({ message: READ_ONLY_REFUSAL });
            const response = yield* Effect.mapError(sent, () => unreachable);
            if (response.status < 400) return response;
            if (response.status === EditConflict.status && (yield* isConflict(response))) return response;
            return yield* refuse(response);
          })
        )
      );
    })
  );
}
