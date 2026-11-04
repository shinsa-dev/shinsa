import { Effect, type Layer } from 'effect';
import { type CliIo, executeCli } from '../../src/cli/index.ts';
import { CliLayer } from '../../src/cli/layers.ts';

export function runCliEffect<A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof CliLayer>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(CliLayer)));
}

export function runCli(args: string[], io?: CliIo) {
  return runCliEffect(executeCli(args, io));
}
