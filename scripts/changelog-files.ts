import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGES_DIRECTORY } from '../packages/core/src/changelog/index.ts';
import type { ChangeFile } from './changelog-rules.ts';

export function listChangeFiles(root: string): ChangeFile[] {
  return [...new Bun.Glob(`${CHANGES_DIRECTORY}/*`).scanSync({ cwd: root, dot: true })]
    .sort()
    .map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
}
