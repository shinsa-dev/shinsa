import { join } from 'node:path';
import { Effect, Option } from 'effect';
import { readLockHolder } from '../../src/instance/lock/file.ts';
import { LOCK_FILE } from '../../src/instance/lock/schema.ts';

export function selectLockHolder(dataDir: string) {
  return Option.getOrNull(Effect.runSync(readLockHolder(join(dataDir, LOCK_FILE))));
}
