import { HOUR_MS } from '../domain/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';

export const PRESENCE_RETENTION_HOURS = 53 * 7 * 24;

export function resolvePresenceHour(at: number) {
  return Math.floor(at / HOUR_MS);
}

function prunePresence(state: ShinsaState, hour: number) {
  for (const key of Object.keys(state.presence)) {
    if (Number(key) <= hour - PRESENCE_RETENTION_HOURS) removeEntry(state, 'presence', key);
  }
}

export function recordPresence(state: ShinsaState, at: number) {
  const hour = resolvePresenceHour(at);
  const key = String(hour);
  const count = state.presence[key];
  writeEntry(state, 'presence', key, (count ?? 0) + 1);
  if (count === undefined) prunePresence(state, hour);
}
