import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { OBJECT_CACHE_BYTES, type ObjectCacheHandle } from './objects/schema.ts';
import { makeObjectCache } from './objects/service.ts';

export class ObjectCache {
  readonly handle: ObjectCacheHandle;

  constructor(limit = OBJECT_CACHE_BYTES) {
    this.handle = edgeRuntime.runSync(makeObjectCache({ limit }));
  }

  get size() {
    return edgeRuntime.runSync(this.handle.size);
  }

  read<T>(key: string, create: () => Promise<T>, measure: (value: T) => number): Promise<T> {
    return edgeRuntime.runPromise(this.handle.read(key, Effect.promise(create), measure));
  }
}
