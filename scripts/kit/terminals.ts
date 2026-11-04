import { Context, Effect, Layer, Scope } from 'effect';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import type { ResourceMonitor } from '../../apps/engine/src/resources/index.ts';
import { ShellLayer } from '../../apps/engine/src/shell/layers.ts';
import { Terminals } from '../../apps/engine/src/terminals/index.ts';
import { TerminalsLayer } from '../../apps/engine/src/terminals/layers.ts';
import { TerminalFiles } from '../../apps/engine/src/terminals/store/service.ts';
import type { MachineResources, ServiceDefinition } from '../../packages/core/src/index.ts';

const TERMINAL_FILES = TerminalFiles.layer.pipe(Layer.provide(JsonFile.layer));

export const runTerminals = Effect.runSync;

export const runTerminalsAsync = Effect.runPromise;

export function writeTerminalServices(dataDir: string, services: readonly ServiceDefinition[]) {
  Effect.runSync(
    TerminalFiles.use((files) => files.writeServices(dataDir, services)).pipe(Effect.provide(TERMINAL_FILES))
  );
}

export function readTerminalServices(dataDir: string) {
  return Effect.runSync(
    TerminalFiles.use((files) => files.readServices(dataDir)).pipe(Effect.provide(TERMINAL_FILES))
  );
}

export function startTerminals(config: ServerConfig, version: string) {
  const scope = Effect.runSync(Scope.make());
  const layer = Terminals.layer({ version, env: Bun.env }).pipe(
    Layer.provide(TerminalsLayer),
    Layer.provide(Layer.mergeAll(ShellLayer, JsonFile.layer, Layer.succeed(EngineConfig, config)))
  );
  return Effect.runPromise(
    Layer.buildWithScope(layer, scope).pipe(Effect.map((context) => Context.get(context, Terminals)))
  );
}

export function createFixedResources(snapshot: () => MachineResources): ResourceMonitor['Service'] {
  return {
    snapshot: Effect.sync(snapshot),
    subscribe: () => Effect.succeed(Effect.void),
    refresh: Effect.void,
    measureDisk: Effect.void,
  };
}
