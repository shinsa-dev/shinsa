interface FakeRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

export function createFakeIndexedDb(options: { fail?: boolean; error?: DOMException } = {}) {
  const values = new Map<string, unknown>();
  const state = { opened: 0, stores: [] as string[] };

  function settle<T>(result: T): FakeRequest<T> {
    const request: FakeRequest<T> = { result, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (options.fail) {
        request.error = options.error ?? null;
        request.onerror?.();
      } else request.onsuccess?.();
    });
    return request;
  }

  const objects = {
    get: (key: string) => settle(values.get(key)),
    put: (value: unknown, key: string) => {
      values.set(key, value);
      return settle(key);
    },
    delete: (key: string) => {
      values.delete(key);
      return settle(undefined);
    },
    getAllKeys: () => settle([...values.keys()]),
  };

  const database = {
    createObjectStore: (name: string) => {
      state.stores.push(name);
      return objects;
    },
    transaction: () => ({ objectStore: () => objects }),
  };

  const factory = {
    open: () => {
      state.opened += 1;
      const request = settle(database) as FakeRequest<typeof database>;
      queueMicrotask(() => request.onupgradeneeded?.());
      return request;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    get opened() {
      return state.opened;
    },
    get stores() {
      return state.stores;
    },
  };
}
