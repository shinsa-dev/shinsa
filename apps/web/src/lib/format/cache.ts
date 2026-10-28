export interface Cache<Value> {
  read: (key: string, create: () => Value) => Value;
  peek: (key: string) => Value | undefined;
  size: () => number;
  clear: () => void;
}

export function createCache<Value>(limit: number): Cache<Value> {
  const entries = new Map<string, Value>();
  return {
    read(key, create) {
      if (entries.has(key)) {
        const value = entries.get(key) as Value;
        entries.delete(key);
        entries.set(key, value);
        return value;
      }
      const value = create();
      entries.set(key, value);
      if (entries.size > limit) entries.delete(entries.keys().next().value as string);
      return value;
    },
    peek: (key) => entries.get(key),
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

export function createScopedCache<Scope extends object, Value>(limit: number) {
  const scopes = new WeakMap<Scope, Cache<Value>>();
  return (scope: Scope) => {
    let cache = scopes.get(scope);
    if (!cache) {
      cache = createCache<Value>(limit);
      scopes.set(scope, cache);
    }
    return cache;
  };
}
