import { Context, type Deferred, type Exit } from 'effect';

export interface CachedEntry {
  readonly value: Deferred.Deferred<Exit.Exit<unknown, unknown>>;
  readonly bytes: number;
}

export interface CachedObjects {
  readonly entries: ReadonlyMap<string, CachedEntry>;
  readonly bytes: number;
}

const OBJECT_CACHE_BYTES = 64 * 1024 * 1024;

export const ObjectCacheBytes = Context.Reference<number>('shinsa/engine/git/objects/ObjectCacheBytes', {
  defaultValue: () => OBJECT_CACHE_BYTES,
});
