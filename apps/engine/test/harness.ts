import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { JsonLogger } from '../src/log/service.ts';
import { Shell } from '../src/shell/service.ts';
import { StoreLayer } from '../src/store/layers.ts';

const TestLayer = Layer.mergeAll(
  JsonLogger,
  Shell.layer.pipe(Layer.provide(BunServices.layer)),
  StoreLayer(':memory:')
);

export function runTest<A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));
}
