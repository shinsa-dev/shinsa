import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_FORMAT } from './schema.ts';

function resolveCoreSource() {
  return dirname(fileURLToPath(import.meta.resolve('@shinsa/core')));
}

export function resolveStateVersion(root = resolveCoreSource()): string | null {
  try {
    const files = [...new Bun.Glob('**/*.ts').scanSync({ cwd: root })].sort();
    if (files.length === 0) return null;
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(`shinsa-state-${SNAPSHOT_FORMAT}`);
    for (const file of files) {
      hasher.update(`\n${file}\n`);
      hasher.update(readFileSync(join(root, file)));
    }
    return hasher.digest('hex').slice(0, 24);
  } catch {
    return null;
  }
}
