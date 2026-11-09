import { join } from 'node:path';
import { Effect } from 'effect';
import { isPresent } from '../../files/probe.ts';
import { CACHES_DIR, TURBO_CACHE, TURBO_CONFIG } from '../schema.ts';

export function resolveRepoCachePath(dataDir: string, repoId: string) {
  return join(dataDir, CACHES_DIR, repoId);
}

export const resolveSharedCacheEnv = Effect.fn('Checks.resolveSharedCacheEnv')(function* (
  checkout: string,
  dataDir: string,
  repoId: string
) {
  const turbo = yield* isPresent(join(checkout, TURBO_CONFIG));
  const env: Record<string, string> = turbo
    ? { TURBO_CACHE_DIR: join(resolveRepoCachePath(dataDir, repoId), TURBO_CACHE) }
    : {};
  return env;
});
