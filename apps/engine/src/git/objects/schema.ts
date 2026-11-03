import type { Deferred, Effect, Exit } from 'effect';

export interface CachedEntry {
  readonly value: Deferred.Deferred<Exit.Exit<unknown, unknown>>;
  readonly bytes: number;
}

export interface CachedObjects {
  readonly entries: ReadonlyMap<string, CachedEntry>;
  readonly bytes: number;
}

export interface ObjectCacheDefinition {
  readonly limit: number;
}

export interface ObjectCacheHandle {
  readonly size: Effect.Effect<number>;
  readonly read: <A, E>(
    key: string,
    create: Effect.Effect<A, E>,
    measure: (value: A) => number
  ) => Effect.Effect<A, E>;
}

export const OBJECT_CACHE_BYTES = 64 * 1024 * 1024;
