import { BunServices } from '@effect/platform-bun';
import { Effect, type FileSystem, Layer } from 'effect';
import { MachineConfigFile } from '../src/config/machine/service.ts';
import { JsonLogger } from '../src/log/service.ts';
import { Shell } from '../src/shell/service.ts';
import { StoreLayer } from '../src/store/layers.ts';

const TestLayer = Layer.mergeAll(
  JsonLogger,
  MachineConfigFile.layer,
  Shell.layer.pipe(Layer.provideMerge(BunServices.layer)),
  StoreLayer(':memory:')
);

export function runTest<A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));
}

export function runFiles<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
}
