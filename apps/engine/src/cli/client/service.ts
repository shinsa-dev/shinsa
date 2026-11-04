import { DomainError } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { Context, Effect, Layer } from 'effect';
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
  HttpIncomingMessage,
} from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { REQUEST_FAILED } from '../../http/schema.ts';
import {
  EngineAnswerInvalid,
  type EngineClientOptions,
  EngineErrorBody,
  EngineNotRunning,
  NOT_RUNNING,
} from './schema.ts';

export class EngineClient extends Context.Service<
  EngineClient,
  HttpApiClient.ForApi<typeof EngineApi, DomainError | EngineNotRunning | EngineAnswerInvalid>
>()('shinsa/engine/cli/EngineClient') {
  static readonly layer = (options: EngineClientOptions) =>
    Layer.effect(
      EngineClient,
      Effect.gen(function* () {
        const notRunning = new EngineNotRunning({ message: NOT_RUNNING });
        const wake = options.wake ?? Effect.succeed(false);
        const reach = (
          sent: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>
        ) =>
          Effect.catch(sent, () =>
            Effect.flatMap(wake, (woke) =>
              woke ? Effect.mapError(sent, () => notRunning) : Effect.fail(notRunning)
            )
          );
        const refuse = (response: HttpClientResponse.HttpClientResponse) =>
          HttpIncomingMessage.schemaBodyJson(EngineErrorBody)(response).pipe(
            Effect.mapError(
              () =>
                new EngineAnswerInvalid({
                  message: `Shinsa on ${options.base} answered ${response.status} without JSON.`,
                })
            ),
            Effect.flatMap((body) =>
              Effect.fail(
                new DomainError({ code: body.error.code ?? REQUEST_FAILED, message: body.error.message })
              )
            )
          );
        const httpClient = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(HttpClientRequest.prependUrl(options.base)),
          HttpClient.transform((sent) =>
            Effect.flatMap(reach(sent), (response) =>
              response.status < 400 ? Effect.succeed(response) : refuse(response)
            )
          )
        );
        return yield* HttpApiClient.makeWith(EngineApi, { httpClient });
      })
    );
}
