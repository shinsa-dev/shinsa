import { type Effect, Layer, ManagedRuntime } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { EngineHttp } from './engine-http/service.ts';
import { EngineClient } from './engine/service.ts';
import { RemoteClient } from './remote/service.ts';
import type { AppServices } from './schema.ts';

export const AppTransport = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(
    FetchHttpClient.Fetch,
    Object.assign((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init), {
      preconnect: globalThis.fetch.preconnect,
    })
  ),
  Layer.succeed(HttpClient.TracerPropagationEnabled, false)
);

export const AppLayer = Layer.mergeAll(EngineClient.layer, RemoteClient.layer).pipe(
  Layer.provideMerge(EngineHttp.layer),
  Layer.provideMerge(AppTransport)
);

export const appRuntime = ManagedRuntime.make(AppLayer);

export function runApp<A, E>(effect: Effect.Effect<A, E, AppServices>) {
  return appRuntime.runPromise(effect);
}
