import type { TimingSpan } from '@shinsa/core';
import { NOW } from './state.ts';

const HOUR = 60 * 60_000;

const DAY = 24 * HOUR;

export function createNights(days = 5, now = NOW): Record<string, TimingSpan> {
  const today = Math.floor(now / DAY);
  return Object.fromEntries(
    Array.from({ length: days }, (_, index) => {
      const day = (today - days + index) * DAY;
      return [String(day), { from: day, to: day + 8 * HOUR }];
    })
  );
}
