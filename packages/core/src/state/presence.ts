import { type Focus, HOUR_MS, type TimingSpan } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';

export const PRESENCE_RETENTION_HOURS = 53 * 7 * 24;

const PRESENCE_RETENTION_MS = PRESENCE_RETENTION_HOURS * HOUR_MS;

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

function pruneSpans(state: ShinsaState, key: 'away' | 'focusHistory', at: number) {
  for (const [id, span] of Object.entries(state[key])) {
    if (span.to !== null && span.to <= at - PRESENCE_RETENTION_MS) removeEntry(state, key, id);
  }
}

export function recordAway(state: ShinsaState, event: EventOf<'away.recorded'>) {
  const span: TimingSpan = { from: event.from, to: event.to };
  writeEntry(state, 'away', String(event.from), span);
  pruneSpans(state, 'away', event.at);
}

export function recordFocus(state: ShinsaState, focus: Focus, at: number) {
  for (const [id, span] of Object.entries(state.focusHistory)) {
    if (span.to === null) writeEntry(state, 'focusHistory', id, { ...span, to: at });
  }
  if (focus.projectId) {
    writeEntry(state, 'focusHistory', String(at), {
      projectId: focus.projectId,
      from: at,
      to: null,
      until: focus.until,
    });
  }
  pruneSpans(state, 'focusHistory', at);
}
