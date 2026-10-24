export function createSignal() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish() {
      for (const listener of listeners) listener();
    },
  };
}
