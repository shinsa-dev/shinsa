import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { listEntries } from '../apps/engine/src/files/probe.ts';
import { CHANGES_DIRECTORY } from '../packages/core/src/changelog/index.ts';
import type { ChangeFile } from './changelog-rules.ts';

export const listChangeFiles = Effect.fn('Changelog.listChangeFiles')(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const files: ChangeFile[] = [];
  for (const name of yield* listEntries(join(root, CHANGES_DIRECTORY))) {
    const path = `${CHANGES_DIRECTORY}/${name}`;
    const info = yield* fs.stat(join(root, path));
    if (info.type === 'File') files.push({ path, source: yield* fs.readFileString(join(root, path)) });
  }
  return files;
});
