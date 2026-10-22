const MINUTE = 60_000;

const listeners = new Set<() => void>();

let timer: ReturnType<typeof setInterval> | undefined;

export function subscribeToMinutes(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const notify of listeners) notify();
  }, MINUTE);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}
