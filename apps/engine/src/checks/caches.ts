import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const UNUSED_CACHE_MS = 14 * 24 * 60 * 60 * 1000;

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

function listEntries(dir: string) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : [];
}

export function pruneSharedCaches(dataDir: string, repoIds: string[], now: number) {
  const known = new Set(repoIds);
  for (const repoId of listEntries(join(dataDir, 'caches'))) {
    const path = resolveRepoCachePath(dataDir, repoId);
    if (!known.has(repoId)) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    const turbo = join(path, 'turbo');
    for (const name of listEntries(turbo)) {
      const entry = join(turbo, name);
      if (now - statSync(entry).mtimeMs > UNUSED_CACHE_MS) rmSync(entry, { recursive: true, force: true });
    }
  }
}
