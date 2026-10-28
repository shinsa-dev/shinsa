import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created: string[] = [];

export function createTempDir(prefix = 'shinsa-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function removeTempDirs() {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
