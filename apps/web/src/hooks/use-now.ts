import { useSyncExternalStore } from 'react';
import { resolveSecond, subscribeToSeconds } from '@/lib/format/clock.ts';

export function useNow() {
  return useSyncExternalStore(subscribeToSeconds, () => resolveSecond());
}
