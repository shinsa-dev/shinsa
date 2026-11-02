import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { edgeRuntime } from '../runtime/edge.ts';
import { NpmRegistry } from './registry/service.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function requestLatestVersion(name: string, fetchFn?: FetchLike) {
  const read = NpmRegistry.use((registry) => registry.latest(name));
  if (!fetchFn) return edgeRuntime.runPromise(read);
  const registry = NpmRegistry.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign((url: string | URL | Request, init?: RequestInit) => fetchFn(String(url), init ?? {}), {
          preconnect: fetch.preconnect,
        })
      )
    )
  );
  return Effect.runPromise(read.pipe(Effect.provide(registry)));
}
