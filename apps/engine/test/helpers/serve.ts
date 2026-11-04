import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineServer } from '../../src/http/server/service.ts';
import { resolveLockError } from '../../src/instance/lock/index.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { EngineLayer } from '../../src/serve/layers.ts';
import type { ShinsaOptions } from '../../src/serve/schema.ts';
import { Engine, type EngineRunner } from './engine.ts';

export interface Shinsa {
  url: string;
  engine: Engine;
  stop: () => Promise<void>;
}

export function startShinsa(config: ServerConfig, options: ShinsaOptions = {}): Promise<Shinsa> {
  const stop = (): Promise<void> => runtime.dispose();
  const runtime = ManagedRuntime.make(
    EngineLayer(config, options, Effect.promise(stop)).pipe(Layer.provideMerge(JsonLogger))
  );
  return Effect.runPromise(
    runtime.contextEffect.pipe(
      Effect.map((context) => {
        const core = Context.get(context, EngineCore);
        const engine = new Engine({ core, runner: runtime as unknown as EngineRunner, dispose: stop });
        return { url: Context.get(context, EngineServer).url, engine, stop };
      }),
      Effect.onError(() => runtime.disposeEffect),
      Effect.catchTags({
        ServerRunning: (error) => Effect.fail(resolveLockError(error)),
        LockContended: (error) => Effect.fail(resolveLockError(error)),
      })
    )
  );
}
