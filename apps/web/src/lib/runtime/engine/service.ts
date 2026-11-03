import { EngineApi } from '@shinsa/core/engine-api';
import { Context, Effect, Layer, Predicate } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { EngineHttp } from '../engine-http/service.ts';
import {
  ENGINE_ANSWER_UNREADABLE_MESSAGE,
  EngineAnswerInvalid,
  type EngineFailure,
  LINES_TYPE,
  MACHINE_PARAM,
} from './schema.ts';

export class EngineClient extends Context.Service<
  EngineClient,
  HttpApiClient.ForApi<typeof EngineApi, EngineFailure>
>()('shinsa/web/runtime/engine/EngineClient') {
  static readonly layer = Layer.effect(
    EngineClient,
    Effect.gen(function* () {
      const unreadable = new EngineAnswerInvalid({ message: ENGINE_ANSWER_UNREADABLE_MESSAGE });
      return yield* HttpApiClient.makeWith(EngineApi, {
        httpClient: yield* EngineHttp,
        transformResponse: Effect.mapError((error) =>
          Predicate.isTagged(error, 'SchemaError') || Predicate.isTagged(error, 'HttpClientError')
            ? unreadable
            : error
        ),
      });
    })
  );

  static readonly through = (
    prepare: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
  ) =>
    Layer.fresh(EngineClient.layer).pipe(
      Layer.provide(Layer.fresh(EngineHttp.layer)),
      Layer.provide(
        Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, HttpClient.mapRequest(prepare)))
      )
    );

  static readonly onMachine = (machineId: string) =>
    EngineClient.through(HttpClientRequest.setUrlParam(MACHINE_PARAM, machineId));

  static readonly askingLines = EngineClient.through(HttpClientRequest.setHeader('accept', LINES_TYPE));
}
