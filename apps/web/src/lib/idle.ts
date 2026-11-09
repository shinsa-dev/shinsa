import { scheduleAfter } from '@/lib/runtime/timers.ts';

export function scheduleIdle(run: () => void, timeoutMs: number, fallbackMs = timeoutMs) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: timeoutMs });
    return () => cancelIdleCallback(handle);
  }
  return scheduleAfter(fallbackMs, run);
}
