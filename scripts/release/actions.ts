import { appendFileSync } from 'node:fs';
import { Config, Effect } from 'effect';

const appendToActionsFile = Effect.fn('appendToActionsFile')(function* (variable: string, text: string) {
  const file = yield* Effect.orDie(Config.String(variable).pipe(Config.withDefault('')));
  if (!file) return;
  yield* Effect.sync(() => appendFileSync(file, text));
});

export const recordActionsOutputs = Effect.fn('recordActionsOutputs')(function* (lines: readonly string[]) {
  yield* appendToActionsFile('GITHUB_OUTPUT', `${lines.join('\n')}\n`);
});

export const recordStepSummary = Effect.fn('recordStepSummary')(function* (summary: string) {
  yield* appendToActionsFile('GITHUB_STEP_SUMMARY', `${summary}\n\n`);
});
