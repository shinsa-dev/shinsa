import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { executeCli } from '../src/cli/index.ts';
import { CliLayer } from '../src/cli/layers.ts';
import { EUNOE_COMMAND } from '../src/eunoe/command.ts';

if (Bun.argv[2] === EUNOE_COMMAND) {
  process.argv.splice(2, 1);
  await import('../node_modules/@chroxify/eunoe/src/cli/main.ts');
} else {
  BunRuntime.runMain(
    executeCli(Bun.argv.slice(2)).pipe(
      Effect.tap((code) =>
        Effect.sync(() => {
          process.exitCode = code;
        })
      ),
      Effect.provide(CliLayer)
    )
  );
}
