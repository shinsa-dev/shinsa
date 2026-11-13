import { MINUTE_MS } from '@shinsa/core';
import { scheduleEvery } from '@/lib/runtime/timers.ts';

const SECOND_MS = 1000;

function createClock(periodMs: number) {
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  return (listener: () => void) => {
    listeners.add(listener);
    stop ??= scheduleEvery(periodMs, () => {
      for (const notify of listeners) notify();
    });
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      stop?.();
      stop = undefined;
    };
  };
}

export const subscribeToMinutes = createClock(MINUTE_MS);

export const subscribeToSeconds = createClock(SECOND_MS);

export function resolveSecond(now = Date.now()) {
  return now - (now % SECOND_MS);
}
