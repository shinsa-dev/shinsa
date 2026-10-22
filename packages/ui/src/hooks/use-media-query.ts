import * as React from 'react';

/**
 * Whether a media query matches, kept in step with the browser. `fallback` is
 * the answer before there is a window (server render), so pick the value that
 * renders the safer layout.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback
  );
}
