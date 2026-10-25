function createStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

function createMediaQuery(media: string): MediaQueryList {
  return {
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
}

function installServerDom() {
  if (typeof globalThis.location !== 'undefined') return;
  const url = new URL('https://shinsa.dev/');
  Object.assign(globalThis, {
    window: globalThis,
    location: url,
    history: { pushState: () => undefined, replaceState: () => undefined, state: null },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    matchMedia: createMediaQuery,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

installServerDom();
