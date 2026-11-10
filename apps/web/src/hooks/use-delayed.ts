import * as React from 'react';
import { useDelay } from '@/hooks/use-delay.ts';

export const LOADING_DELAY_MS = 300;

export function useDelayed(active: boolean, delayMs: number = LOADING_DELAY_MS) {
  const [shown, setShown] = React.useState(false);
  if (!active && shown) setShown(false);
  useDelay(() => setShown(true), active ? delayMs : null);
  return active && shown;
}
