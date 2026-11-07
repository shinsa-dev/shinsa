import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem } from 'effect';
import { SNAPSHOT_FORMAT, STATE_SOURCE_FILE } from './schema.ts';

function resolveCoreSource() {
  return dirname(fileURLToPath(import.meta.resolve('@shinsa/core')));
}

const hashSource = Effect.fn('Snapshots.hashSource')(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const listed = yield* fs.readDirectory(root, { recursive: true });
  const files = listed.filter((file) => STATE_SOURCE_FILE.test(file)).sort();
  if (files.length === 0) return null;
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(`shinsa-state-${SNAPSHOT_FORMAT}`);
  for (const file of files) {
    hasher.update(`\n${file}\n`);
    hasher.update(yield* fs.readFile(join(root, file)));
  }
  return hasher.digest('hex').slice(0, 24);
});

export const resolveStateVersion = Effect.fn('Snapshots.resolveStateVersion')(function* (
  root = resolveCoreSource()
) {
  return yield* hashSource(root).pipe(Effect.orElseSucceed(() => null));
});
