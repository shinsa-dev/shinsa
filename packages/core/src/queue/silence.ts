import { MINUTE_MS, type Run } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { isRunWaiting } from '../state/queries.ts';

export type SilenceLevel = 'not_applicable' | 'snoozed' | 'ok' | 'suspicious' | 'critical';

export const SILENCE_MINUTES = { suspicious: 5, critical: 15, snooze: 30 } as const;

export function resolveSilenceLevel(state: ShinsaState, run: Run, now: number): SilenceLevel {
  const silence = run.silence;
  if (run.endedAt !== null || run.status === 'queued' || !silence || silence.since === null) {
    return 'not_applicable';
  }
  if (silence.dismissed || isRunWaiting(state, run)) return 'not_applicable';
  if (silence.snoozedUntil !== null && silence.snoozedUntil > now) return 'snoozed';
  const minutes = (now - silence.since) / MINUTE_MS;
  if (minutes >= SILENCE_MINUTES.critical) return 'critical';
  return minutes >= SILENCE_MINUTES.suspicious ? 'suspicious' : 'ok';
}
