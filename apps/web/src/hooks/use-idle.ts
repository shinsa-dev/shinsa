import * as React from 'react';
import { scheduleIdle } from '@/lib/idle.ts';

const IDLE_TIMEOUT_MS = 2000;

export function useIdle() {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    if (idle) return;
    return scheduleIdle(() => setIdle(true), IDLE_TIMEOUT_MS);
  }, [idle]);
  return idle;
}

export function useIdleValue<T>(value: T) {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (Object.is(settled, value)) return;
    return scheduleIdle(() => setSettled(value), IDLE_TIMEOUT_MS);
  }, [value, settled]);
  return settled;
}
