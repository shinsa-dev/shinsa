export function scheduleIdle(run: () => void, timeoutMs: number, fallbackMs = timeoutMs) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: timeoutMs });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, fallbackMs);
  return () => clearTimeout(timer);
}
