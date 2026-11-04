import { Effect, Layer } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import { createConfigAt } from './config.ts';
import { createTempDir } from './temp.ts';

export function createTestEvidence(evidenceDir: string) {
  const config = Layer.succeed(EngineConfig, { ...createConfigAt(createTempDir()), evidenceDir });
  return Effect.runSync(Evidence.pipe(Effect.provide(Evidence.layer.pipe(Layer.provide(config)))));
}
