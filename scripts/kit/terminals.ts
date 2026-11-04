import { Effect, Layer } from 'effect';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import { TerminalFiles } from '../../apps/engine/src/terminals/store/service.ts';
import type { ServiceDefinition } from '../../packages/core/src/index.ts';

const TERMINAL_FILES = TerminalFiles.layer.pipe(Layer.provide(JsonFile.layer));

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
