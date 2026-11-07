import { Config, Effect, FileSystem } from 'effect';
import { ActionsFileFailed } from './schema.ts';

const appendToActionsFile = Effect.fn('appendToActionsFile')(function* (variable: string, text: string) {
  const file = yield* Effect.orDie(Config.String(variable).pipe(Config.withDefault('')));
  if (!file) return;
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .writeFileString(file, text, { flag: 'a' })
    .pipe(
      Effect.mapError(
        (error) =>
          new ActionsFileFailed({ message: `Could not write ${variable} at ${file}: ${error.message}` })
      )
    );
});

export const recordActionsOutputs = Effect.fn('recordActionsOutputs')(function* (lines: readonly string[]) {
  yield* appendToActionsFile('GITHUB_OUTPUT', `${lines.join('\n')}\n`);
});

export const recordStepSummary = Effect.fn('recordStepSummary')(function* (summary: string) {
  yield* appendToActionsFile('GITHUB_STEP_SUMMARY', `${summary}\n\n`);
});
