type Listener = () => void;

/** A stand-in for `window.matchMedia` whose answers the test sets and flips. */
export function installMedia(initial: Record<string, boolean> = {}) {
  const answers = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<Listener>>();
  const original = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return answers.get(query) ?? false;
    },
    addEventListener: (_type: string, listener: Listener) => {
      const set = listeners.get(query) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(query, set);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.get(query)?.delete(listener);
    },
  })) as unknown as typeof window.matchMedia;

  return {
    flip(query: string, matches: boolean) {
      answers.set(query, matches);
      for (const listener of listeners.get(query) ?? []) listener();
    },
    listenerCount(query: string) {
      return listeners.get(query)?.size ?? 0;
    },
    restore() {
      window.matchMedia = original;
    },
  };
}
