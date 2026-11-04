import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect } from 'effect';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { describeCanaryDecision, resolveCanaryDecision, selectLastCanaryTag } from './release-version.ts';
import { recordActionsOutputs, recordStepSummary } from './release/actions.ts';

const program = Effect.gen(function* () {
  const command = yield* Command;
  const head = (yield* Effect.orDie(Config.String('RELEASE_SHA').pipe(Config.withDefault('')))) || 'HEAD';
  const base = selectLastCanaryTag(yield* command.lines(['git', 'tag', '--list', 'v*']));
  const changed = base ? yield* command.lines(['git', 'diff', '--name-only', base, head]) : [];
  const decision = resolveCanaryDecision(base, changed);
  const summary = describeCanaryDecision(decision);
  yield* recordActionsOutputs([`build=${decision.build}`]);
  yield* recordStepSummary(summary);
  yield* Console.log(summary);
});

program.pipe(
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
