import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

export const createTempDirectory = Effect.fn('createTempDirectory')(function* (prefix: string) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
  );
});
