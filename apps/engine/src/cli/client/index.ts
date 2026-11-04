import { EngineApi } from '@shinsa/core/engine-api';
import { Effect, Layer, Predicate } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { HttpApi } from 'effect/http-api';
import { EngineAnswerInvalid, type EngineCalls, type EngineClientOptions } from './schema.ts';
import { EngineClient } from './service.ts';

export {
  type EngineCalls,
  type EngineFailure,
  type EngineClientOptions,
  type EngineWake,
  NOT_RUNNING,
} from './schema.ts';

const PASSED_FAILURES = ['DomainError', 'EngineNotRunning', 'EngineAnswerInvalid'];

type EngineMethod = (request: unknown) => Effect.Effect<unknown, Error>;

type EngineMethods = Record<string, Record<string, EngineMethod>>;

export function createEngineCalls(options: EngineClientOptions): EngineCalls {
  const layer = EngineClient.layer(options).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch ?? globalThis.fetch))
  );
  const invalid = new EngineAnswerInvalid({ message: `Shinsa on ${options.base} answered without JSON.` });
  const call =
    (group: string, name: string): EngineMethod =>
    (request) =>
      EngineClient.use(
        (client) => (client as unknown as EngineMethods)[group]?.[name]?.(request) ?? Effect.fail(invalid)
      ).pipe(
        Effect.provide(layer),
        Effect.mapError((error) =>
          PASSED_FAILURES.some((tag) => Predicate.isTagged(error, tag)) ? error : invalid
        )
      );
  const calls: EngineMethods = {};
  HttpApi.reflect(EngineApi, {
    onGroup: ({ group }) => {
      calls[group.identifier] = {};
    },
    onEndpoint: ({ group, endpoint }) => {
      calls[group.identifier] = {
        ...calls[group.identifier],
        [endpoint.identifier]: call(group.identifier, endpoint.identifier),
      };
    },
  });
  return calls as unknown as EngineCalls;
}
