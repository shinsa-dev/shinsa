import { Effect, Layer } from 'effect';
import { JsonLogger } from '../src/log/service.ts';

const TestLayer = Layer.mergeAll(JsonLogger);

export function runTest<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));
}
