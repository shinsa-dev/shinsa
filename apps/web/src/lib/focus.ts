import { HOUR_MS, resolveFocusProject, type ShinsaState } from '@shinsa/core';
import { resolveEndOfDay } from '@/lib/format/time.ts';
import { selectProject } from '@/lib/projects.ts';

const FOCUS_HOURS = 2;

export function selectFocus(state: ShinsaState, now = Date.now()) {
  return selectProject(state, resolveFocusProject(state, now));
}

export function resolveFocusUntil(keep: 'hours' | 'tonight', now = Date.now()) {
  return keep === 'hours' ? now + FOCUS_HOURS * HOUR_MS : resolveEndOfDay(now);
}
