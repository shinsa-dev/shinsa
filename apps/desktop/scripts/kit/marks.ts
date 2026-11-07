import { Effect, FileSystem } from 'effect';
import { MARK_PATH, ScriptStepFailed } from './schema.ts';

export const readMarkPaths = Effect.fn('DesktopScript.readMarkPaths')(function* (logoPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(logoPath).pipe(Effect.orDie);
  const paths = [...source.matchAll(MARK_PATH)].map((match) => match[1] ?? '');
  if (paths.length === 0)
    return yield* new ScriptStepFailed({ message: `No mark paths found in ${logoPath}.` });
  return paths;
});
