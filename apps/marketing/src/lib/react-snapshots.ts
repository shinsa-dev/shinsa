import * as React from 'react';

// @ts-expect-error React's types use `export =`, which `export *` cannot read; the bundler re-exports it.
export * from 'react';

export default React;

export function useSyncExternalStore<T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T
) {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot);
}
