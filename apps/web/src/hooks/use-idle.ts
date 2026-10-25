import * as React from 'react';

const IDLE_TIMEOUT_MS = 2000;

function requestIdle(run: () => void) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, IDLE_TIMEOUT_MS);
  return () => clearTimeout(timer);
}

export function useIdle() {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    if (idle) return;
    return requestIdle(() => setIdle(true));
  }, [idle]);
  return idle;
}

export function useIdleValue<T>(value: T) {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (Object.is(settled, value)) return;
    return requestIdle(() => setSettled(value));
  }, [value, settled]);
  return settled;
}
