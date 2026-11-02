import { Effect, Layer, ManagedRuntime, Predicate } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { EngineAnswerInvalid, type EngineCalls, type EngineClientOptions } from './schema.ts';
import { EngineClient } from './service.ts';

export {
  EngineAnswerInvalid,
  type EngineCalls,
  type EngineClientOptions,
  EngineNotRunning,
  type EngineWake,
  NOT_RUNNING,
} from './schema.ts';
export { EngineClient } from './service.ts';

const PASSED_FAILURES = ['DomainError', 'EngineNotRunning', 'EngineAnswerInvalid'];

type EngineMethod = (request: unknown) => Effect.Effect<unknown, Error>;

export function createEngineCalls(options: EngineClientOptions): EngineCalls {
  const runtime = ManagedRuntime.make(
    EngineClient.layer(options).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch ?? globalThis.fetch))
    )
  );
  const invalid = new EngineAnswerInvalid({ message: `Shinsa on ${options.base} answered without JSON.` });
  const run = (call: Effect.Effect<unknown, Error>) =>
    runtime.runPromise(
      Effect.mapError(call, (error) =>
        PASSED_FAILURES.some((tag) => Predicate.isTagged(error, tag)) ? error : invalid
      )
    );
  const client = runtime.runSync(EngineClient.use(Effect.succeed)) as unknown as Record<
    string,
    Record<string, EngineMethod>
  >;
  return Object.fromEntries(
    Object.entries(client).map(([group, methods]) => [
      group,
      Object.fromEntries(
        Object.entries(methods).map(([name, method]) => [name, (request: unknown) => run(method(request))])
      ),
    ])
  ) as unknown as EngineCalls;
}
