import * as React from 'react';

export const LOADING_DELAY_MS = 300;

export function useDelayed(active: boolean, delayMs: number = LOADING_DELAY_MS) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}
