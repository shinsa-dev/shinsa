import * as React from 'react';

export const SPOTLIGHT_HOLD_MS = 1500;

export const SPOTLIGHT_FADE_MS = 600;

export function useSpotlight(key: string | null, request = 0) {
  const [lit, setLit] = React.useState(key);
  React.useEffect(() => {
    void request;
    setLit(key);
    if (!key) return;
    const timer = setTimeout(() => setLit(null), SPOTLIGHT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [key, request]);
  return lit;
}
