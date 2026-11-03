import { type Effect, Layer, ManagedRuntime } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { Socket } from 'effect/socket';
import { EngineHttp } from './engine-http/service.ts';
import { EngineClient } from './engine/service.ts';
import { RemoteClient } from './remote/service.ts';
import type { AppServices, AppTransportServices } from './schema.ts';

function createAppRuntime(transport: Layer.Layer<AppTransportServices>) {
  return ManagedRuntime.make(
    Layer.mergeAll(EngineClient.layer, RemoteClient.layer).pipe(
      Layer.provideMerge(EngineHttp.layer),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
      Layer.provideMerge(transport)
    )
  );
}

let appRuntime = createAppRuntime(
  Layer.mergeAll(
    Layer.succeed(
      FetchHttpClient.Fetch,
      Object.assign((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init), {
        preconnect: globalThis.fetch.preconnect,
      })
    ),
    Socket.layerWebSocketConstructorGlobal
  )
);

export function replaceAppTransport(transport: Layer.Layer<AppTransportServices>) {
  appRuntime = createAppRuntime(transport);
}

export function runApp<A, E>(effect: Effect.Effect<A, E, AppServices>) {
  return appRuntime.runPromise(effect);
}

export function forkApp<A, E>(effect: Effect.Effect<A, E, AppServices>) {
  return appRuntime.runFork(effect);
}
