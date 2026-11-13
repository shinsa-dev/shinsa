import { HID_IDLE_TIME, NANOSECONDS_PER_MS } from './schema.ts';

export function parseHidIdleMs(stdout: string): number | null {
  const match = HID_IDLE_TIME.exec(stdout);
  return match?.[1] ? Math.floor(Number(match[1]) / NANOSECONDS_PER_MS) : null;
}
