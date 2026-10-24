import { MINUTE_MS } from '@shinsa/core';

const SECOND_MS = 1000;

function createClock(periodMs: number) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  return (listener: () => void) => {
    listeners.add(listener);
    timer ??= setInterval(() => {
      for (const notify of listeners) notify();
    }, periodMs);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      clearInterval(timer);
      timer = undefined;
    };
  };
}

export const subscribeToMinutes = createClock(MINUTE_MS);

export const subscribeToSeconds = createClock(SECOND_MS);

export function resolveSecond(now = Date.now()) {
  return now - (now % SECOND_MS);
}
