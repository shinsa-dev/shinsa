import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { retryStep, STAPLE_DELAYS, warnRetry } from './release-retry.ts';
import { ScriptUsage } from './release/schema.ts';

const program = Effect.gen(function* () {
  const command = yield* Command;
  const app = process.argv[2];
  if (!app)
    return yield* new ScriptUsage({
      message: 'Name the app: bun scripts/release-verify.ts release/mac-arm64/Shinsa.app',
    });
  yield* command
    .text(['spctl', '--assess', '--type', 'execute', '--verbose=2', app])
    .pipe(retryStep({ label: 'Gatekeeper', delays: STAPLE_DELAYS, onRetry: warnRetry }));
  yield* command
    .text(['xcrun', 'stapler', 'validate', app])
    .pipe(retryStep({ label: 'Validate the staple', delays: STAPLE_DELAYS, onRetry: warnRetry }));
  yield* Console.log(`Gatekeeper accepts ${app} and its notarization ticket is stapled.`);
});

program.pipe(
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
