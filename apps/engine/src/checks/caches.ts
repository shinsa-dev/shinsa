import { edgeRuntime } from '../runtime/edge.ts';
import { SharedCaches } from './caches/service.ts';

export function resolveRepoCachePath(dataDir: string, repoId: string) {
  return edgeRuntime.runSync(SharedCaches.useSync((caches) => caches.resolvePath(dataDir, repoId)));
}

export function resolveSharedCacheEnv(checkout: string, dataDir: string, repoId: string) {
  return edgeRuntime.runSync(SharedCaches.use((caches) => caches.resolveEnv(checkout, dataDir, repoId)));
}

export function pruneSharedCaches(dataDir: string, repoIds: string[], now: number) {
  edgeRuntime.runSync(SharedCaches.use((caches) => caches.prune(dataDir, repoIds, now)));
}
