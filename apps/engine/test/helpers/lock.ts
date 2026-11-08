import { join } from 'node:path';
import { Option } from 'effect';
import { readLockHolder } from '../../src/instance/lock/file.ts';
import { LOCK_FILE } from '../../src/instance/lock/schema.ts';
import { runFiles } from '../harness.ts';

export async function selectLockHolder(dataDir: string) {
  return Option.getOrNull(await runFiles(readLockHolder(join(dataDir, LOCK_FILE))));
}
