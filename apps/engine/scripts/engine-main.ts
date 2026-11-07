import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { executeCli } from '../src/cli/index.ts';
import { CliLayer } from '../src/cli/layers.ts';
import { EUNOE_COMMAND } from '../src/eunoe/command.ts';
import { EunoeUnavailable } from './schema.ts';

const runEunoe = Effect.gen(function* () {
  yield* Effect.sync(() => process.argv.splice(2, 1));
  yield* Effect.tryPromise({
    try: () => import('../node_modules/@chroxify/eunoe/src/cli/main.ts'),
    catch: (error) => new EunoeUnavailable({ message: `Could not start eunoe: ${String(error)}` }),
  });
});

const runShinsa = executeCli(Bun.argv.slice(2)).pipe(
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code;
    })
  ),
  Effect.provide(CliLayer)
);

BunRuntime.runMain(Bun.argv[2] === EUNOE_COMMAND ? runEunoe : runShinsa);
