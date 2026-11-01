import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveRepoCachePath(dataDir: string, repoId: string) {
  return join(dataDir, 'caches', repoId);
}

export function resolveSharedCacheEnv(
  checkout: string,
  dataDir: string,
  repoId: string
): Record<string, string> {
  if (!existsSync(join(checkout, 'turbo.json'))) return {};
  return { TURBO_CACHE_DIR: join(resolveRepoCachePath(dataDir, repoId), 'turbo') };
}
