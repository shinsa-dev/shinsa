import { type Cause, Deferred, Effect, Exit, Ref } from 'effect';
import type { CachedEntry, CachedObjects, ObjectCacheDefinition, ObjectCacheHandle } from './schema.ts';

export const makeObjectCache = Effect.fn('ObjectCache.make')(function* (definition: ObjectCacheDefinition) {
  const objects = yield* Ref.make<CachedObjects>({ entries: new Map(), bytes: 0 });

  const isCurrent = (current: CachedObjects, key: string, value: CachedEntry['value']) =>
    current.entries.get(key)?.value === value;

  const account = (key: string, value: CachedEntry['value'], bytes: number) =>
    Ref.update(objects, (current) => {
      if (!isCurrent(current, key, value)) return current;
      const entries = new Map(current.entries).set(key, { value, bytes });
      let total = current.bytes + bytes;
      for (const [oldest, candidate] of entries) {
        if (total <= definition.limit || oldest === key) break;
        entries.delete(oldest);
        total -= candidate.bytes;
      }
      return { entries, bytes: total };
    });

  const forget = (key: string, value: CachedEntry['value']) =>
    Ref.update(objects, (current) => {
      if (!isCurrent(current, key, value)) return current;
      const entries = new Map(current.entries);
      entries.delete(key);
      return { entries, bytes: current.bytes };
    });

  const claim = (key: string, fresh: CachedEntry['value']) =>
    Ref.modify(objects, (current): [CachedEntry['value'], CachedObjects] => {
      const known = current.entries.get(key);
      const entries = new Map(current.entries);
      entries.delete(key);
      entries.set(key, known ?? { value: fresh, bytes: 0 });
      return [known?.value ?? fresh, { entries, bytes: current.bytes }];
    });

  const read = Effect.fn('ObjectCache.read')(function* <A, E>(
    key: string,
    create: Effect.Effect<A, E>,
    measure: (value: A) => number
  ) {
    const fresh = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
    const value = yield* claim(key, fresh);
    if (value === fresh)
      yield* Effect.forkDetach(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(create);
          yield* Exit.isSuccess(exit) ? account(key, fresh, measure(exit.value)) : forget(key, fresh);
          yield* Deferred.succeed(fresh, exit);
        })
      );
    const settled = yield* Deferred.await(value);
    if (Exit.isSuccess(settled)) return settled.value as A;
    return yield* Effect.failCause(settled.cause as Cause.Cause<E>);
  });

  const handle: ObjectCacheHandle = {
    size: Effect.map(Ref.get(objects), (current) => current.entries.size),
    read,
  };
  return handle;
});
