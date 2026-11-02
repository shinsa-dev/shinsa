import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import type { ServerConfig } from './config/index.ts';
import { JsonLogger } from './log/service.ts';
import type { Shinsa, ShinsaOptions } from './serve/schema.ts';
import { Serve } from './serve/service.ts';

export type { Shinsa, ShinsaOptions } from './serve/schema.ts';

export function startShinsa(requested: ServerConfig, options: ShinsaOptions = {}): Promise<Shinsa> {
  const stop = (): Promise<void> => runtime.dispose();
  const runtime = ManagedRuntime.make(Serve.layer(requested, options, stop).pipe(Layer.provide(JsonLogger)));
  return Effect.runPromise(
    runtime.contextEffect.pipe(
      Effect.map((context) => {
        const serve = Context.get(context, Serve);
        return { url: serve.url, engine: serve.engine, stop };
      }),
      Effect.onError(() => runtime.disposeEffect)
    )
  );
}
