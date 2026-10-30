import type { KeyValueStore } from './devices.ts';

const DATABASE = 'shinsa-remote';

const OBJECTS = 'keys';

function settle<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request.'));
  });
}

function openDatabase(factory: IDBFactory) {
  const request = factory.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(OBJECTS);
  };
  return settle(request);
}

export function createIndexedStore(factory: IDBFactory): KeyValueStore {
  let opened: Promise<IDBDatabase> | null = null;
  async function run<T>(mode: IDBTransactionMode, act: (objects: IDBObjectStore) => IDBRequest<T>) {
    opened ??= openDatabase(factory);
    const database = await opened;
    return settle(act(database.transaction(OBJECTS, mode).objectStore(OBJECTS)));
  }
  return {
    read: (key) => run('readonly', (objects) => objects.get(key)),
    write: async (key, value) => {
      await run('readwrite', (objects) => objects.put(value, key));
    },
    remove: async (key) => {
      await run('readwrite', (objects) => objects.delete(key));
    },
  };
}
