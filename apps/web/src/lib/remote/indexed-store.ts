import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { INDEXED_STORE_REFUSED, IndexedStoreFailed, type KeyValueStore } from './schema.ts';

const DATABASE = 'shinsa-remote';

const OBJECTS = 'keys';

export function createIndexedStore(factory: IDBFactory): KeyValueStore {
  function settle<T>(request: IDBRequest<T>) {
    return Effect.callback<T, IndexedStoreFailed>((resume) => {
      request.onsuccess = () => resume(Effect.succeed(request.result));
      request.onerror = () =>
        resume(
          Effect.fail(new IndexedStoreFailed({ message: request.error?.message ?? INDEXED_STORE_REFUSED }))
        );
    });
  }
  const openDatabase = Effect.suspend(() => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OBJECTS);
    };
    return settle(request);
  });
  let opened: Effect.Effect<IDBDatabase, IndexedStoreFailed> | null = null;
  const run = Effect.fn('IndexedStore.run')(function* <T>(
    mode: IDBTransactionMode,
    act: (objects: IDBObjectStore) => IDBRequest<T>
  ) {
    opened ??= yield* Effect.cached(openDatabase);
    const database = yield* opened;
    return yield* settle(act(database.transaction(OBJECTS, mode).objectStore(OBJECTS)));
  });
  return {
    read: (key) => runApp(run('readonly', (objects) => objects.get(key))),
    write: (key, value) => runApp(Effect.asVoid(run('readwrite', (objects) => objects.put(value, key)))),
    remove: (key) => runApp(run('readwrite', (objects) => objects.delete(key))),
    listKeys: () =>
      runApp(
        Effect.map(
          run('readonly', (objects) => objects.getAllKeys()),
          (keys) => keys.map(String)
        )
      ),
  };
}
