import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHES_DIR, TURBO_CACHE, TURBO_CONFIG } from '../schema.ts';

export function resolveRepoCachePath(dataDir: string, repoId: string) {
  return join(dataDir, CACHES_DIR, repoId);
}

export function resolveSharedCacheEnv(
  checkout: string,
  dataDir: string,
  repoId: string
): Record<string, string> {
  if (!existsSync(join(checkout, TURBO_CONFIG))) return {};
  return { TURBO_CACHE_DIR: join(resolveRepoCachePath(dataDir, repoId), TURBO_CACHE) };
}
