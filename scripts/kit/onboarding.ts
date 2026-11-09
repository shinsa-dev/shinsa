import { Context, Effect, Layer, Scope } from 'effect';
import { QuickCalls } from '../../apps/engine/src/agents/quick/service.ts';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import { Onboarding, Prerequisites, SetupCommands } from '../../apps/engine/src/onboarding/index.ts';
import { EngineCore } from '../../apps/engine/src/runtime/engine/service.ts';
import { createMachineLayer } from '../../apps/engine/src/serve/layers.ts';
import { ShellLayer } from '../../apps/engine/src/shell/layers.ts';
import type { Engine } from '../../apps/engine/test/helpers/engine.ts';

export const createIdleOnboarding = Effect.fn('Kit.createIdleOnboarding')(function* ({
  engine,
  config,
}: {
  engine: Engine;
  config: ServerConfig;
}) {
  const base = Layer.merge(Layer.succeed(EngineConfig, config), Layer.succeed(EngineCore, engine.core));
  const local = createMachineLayer({
    discover: () => Promise.resolve({ candidates: [], truncated: false, refused: [] }),
    resolveLogin: () => Promise.resolve(null),
  });
  const silent = () => Effect.succeed(null);
  const commands = Layer.succeed(
    SetupCommands,
    SetupCommands.of({
      run: (command) =>
        Effect.succeed({ ok: true, code: 0, stdout: `${command[0]} 1.0`, stderr: '', timedOut: false }),
      scripts: { resolve: () => null, resolveReply: (command) => command },
    })
  );
  const layer = Onboarding.layer({
    models: { listModels: Effect.succeed([]) },
    accounts: Effect.succeed([]),
    terminals: null,
  }).pipe(
    Layer.provide(Prerequisites.layer),
    Layer.provide(commands),
    Layer.provide(local),
    Layer.provide(
      Layer.mergeAll(
        base,
        Layer.succeed(QuickCalls, QuickCalls.of({ classify: silent, write: silent })),
        JsonFile.layer
      ).pipe(Layer.provideMerge(ShellLayer))
    )
  );
  return Context.get(yield* Layer.buildWithScope(layer, yield* Scope.make()), Onboarding);
});
