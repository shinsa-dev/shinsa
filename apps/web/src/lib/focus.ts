import {
  HOUR_MS,
  type RemoteSnapshot,
  resolveFocusProject,
  resolveFocusTeam,
  type ShinsaState,
} from '@shinsa/core';
import { resolveEndOfDay } from '@/lib/format/time.ts';
import { selectProject } from '@/lib/projects.ts';

const FOCUS_HOURS = 2;

export const YOUR_WORK = 'Your work';

export const UNNAMED_TEAM = 'Your team';

export interface FocusTeam {
  id: string;
  name: string;
}

export function selectFocus(state: ShinsaState, now = Date.now()) {
  return selectProject(state, resolveFocusProject(state, now));
}

export function listFocusTeams(remote: RemoteSnapshot | null): FocusTeam[] {
  return (remote?.teams ?? [])
    .filter((entry) => entry.status === 'member')
    .map((entry) => ({ id: entry.id, name: entry.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function selectFocusTeam(
  state: ShinsaState,
  teams: readonly FocusTeam[],
  now = Date.now()
): FocusTeam | null {
  const teamId = resolveFocusTeam(state, now);
  if (teamId === null) return null;
  return teams.find((team) => team.id === teamId) ?? { id: teamId, name: UNNAMED_TEAM };
}

export function resolveFocusUntil(keep: 'hours' | 'tonight', now = Date.now()) {
  return keep === 'hours' ? now + FOCUS_HOURS * HOUR_MS : resolveEndOfDay(now);
}
