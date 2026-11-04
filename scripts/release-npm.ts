import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { runReleaseNpm } from './release/npm.ts';

runReleaseNpm(process.argv.slice(2)).pipe(
  Effect.flatMap(Console.log),
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
