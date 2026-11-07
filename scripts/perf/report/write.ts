import { Effect, FileSystem } from 'effect';
import { ReportUnwritable } from './schema.ts';

export const writeReport = Effect.fn('PerfReport.write')(function* (path: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .writeFileString(path, text)
    .pipe(Effect.mapError((error) => new ReportUnwritable({ path, message: error.message })));
});

export const appendReport = Effect.fn('PerfReport.append')(function* (path: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .writeFileString(path, text, { flag: 'a' })
    .pipe(Effect.mapError((error) => new ReportUnwritable({ path, message: error.message })));
});
