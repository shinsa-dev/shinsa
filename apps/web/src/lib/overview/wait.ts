import { type Monitor, SILENCE_MINUTES, type SilenceLevel, type StalledReason } from '@shinsa/core';
import { formatSpan, formatUntil } from '@/lib/format/time.ts';

export const STALLED_REASON: Record<StalledReason, string> = {
  needs_you: 'is waiting on you',
  paused: 'is paused',
  cancelled: 'was cancelled',
};

export function describeNextCheckIn(monitor: Monitor, now: number) {
  return formatUntil('Checks in again', monitor.nextCheckAt, now);
}

export function describeGiveUp(monitor: Monitor, now: number) {
  return monitor.timeoutAt <= now
    ? 'gives up at the next check-in'
    : formatUntil('gives up', monitor.timeoutAt, now);
}

export function describeCheckInCount(monitor: Monitor) {
  return `Check-in ${monitor.attempts + 1} of ${monitor.maxAttempts}`;
}

export function describeSilence(level: SilenceLevel, since: number, now: number) {
  if (level !== 'suspicious' && level !== 'critical') return null;
  const quiet = formatSpan(since, now) ?? `${SILENCE_MINUTES.suspicious} minutes`;
  return `No output for ${quiet}`;
}
