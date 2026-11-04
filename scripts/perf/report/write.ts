import { appendFileSync, writeFileSync } from 'node:fs';
import { Effect } from 'effect';
import { ReportUnwritable } from './schema.ts';

export const writeReport = Effect.fn('PerfReport.write')(function* (path: string, text: string) {
  yield* Effect.try({
    try: () => writeFileSync(path, text),
    catch: (error) => new ReportUnwritable({ path, message: String(error) }),
  });
});

export const appendReport = Effect.fn('PerfReport.append')(function* (path: string, text: string) {
  yield* Effect.try({
    try: () => appendFileSync(path, text),
    catch: (error) => new ReportUnwritable({ path, message: String(error) }),
  });
});
