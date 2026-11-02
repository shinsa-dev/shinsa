import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { JsonLogger } from '../src/log/service.ts';
import { Shell } from '../src/shell/service.ts';

const TestLayer = Layer.mergeAll(JsonLogger, Shell.layer.pipe(Layer.provide(BunServices.layer)));

export function runTest<A, E>(effect: Effect.Effect<A, E, Shell>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));
}
