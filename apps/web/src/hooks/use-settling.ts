import * as React from 'react';

export const SETTLE_MS = 400;

export type SettlingPhase = 'active' | 'settling' | null;

export function useSettling(active: boolean, settleMs: number = SETTLE_MS): SettlingPhase {
  const [previous, setPrevious] = React.useState(active);
  const [settling, setSettling] = React.useState(false);
  if (previous !== active) {
    setPrevious(active);
    setSettling(!active);
  }
  React.useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), settleMs);
    return () => clearTimeout(timer);
  }, [settling, settleMs]);
  if (active) return 'active';
  return settling ? 'settling' : null;
}
