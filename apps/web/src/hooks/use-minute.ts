import { useSyncExternalStore } from 'react';
import { subscribeToMinutes } from '@/lib/format/clock.ts';
import { resolveMinute } from '@/lib/format/time.ts';

export function useMinute() {
  return useSyncExternalStore(subscribeToMinutes, () => resolveMinute());
}
