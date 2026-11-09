import {
  type FocusProjects,
  HOUR_MS,
  normaliseFocusProjects,
  type RemoteSnapshot,
  resolveFocusProject,
  resolveFocusProjects,
  resolveFocusInitiative,
  resolveFocusTeam,
  selectSingleFocusProject,
  serializeNames,
  type ShinsaState,
} from '@shinsa/core';
import { resolveEndOfDay } from '@/lib/format/time.ts';
import { selectProject } from '@/lib/projects.ts';

const FOCUS_HOURS = 2;

const NAMED_PROJECTS = 2;

export const YOUR_WORK = 'Your work';

export const UNNAMED_TEAM = 'Your team';

export interface FocusTeam {
  id: string;
  name: string;
}

export interface FocusTarget {
  projectId: string | null;
  teamId: string | null;
  initiativeId?: string;
  projectIds?: string[];
  except?: boolean;
}

export function selectFocus(state: ShinsaState, now = Date.now()) {
  return selectProject(state, resolveFocusProject(state, now));
}

export function selectFocusProjects(state: ShinsaState, now = Date.now()): FocusProjects {
  const { projectIds, except } = resolveFocusProjects(state, now);
  return normaliseFocusProjects(
    projectIds.filter((projectId) => state.projects[projectId] !== undefined),
    except
  );
}

export function resolveFocusLabel(state: ShinsaState, selection: FocusProjects) {
  const names = selection.projectIds
    .flatMap((projectId) => state.projects[projectId]?.name ?? [])
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) return null;
  const named = names.length <= NAMED_PROJECTS ? serializeNames(names) : `${names.length} projects`;
  return selection.except ? `All but ${named}` : named;
}

export function describeStatsScope(label: string, selection: FocusProjects) {
  return selectSingleFocusProject(selection) === null
    ? `Only what is in focus: ${label}`
    : `Only ${label}, the project in focus`;
}

export function toggleFocusProject(selection: FocusProjects, projectId: string): FocusProjects {
  const projectIds = selection.projectIds.includes(projectId)
    ? selection.projectIds.filter((id) => id !== projectId)
    : [...selection.projectIds, projectId];
  return normaliseFocusProjects(projectIds, selection.except);
}

export function resolveFocusTarget(selection: FocusProjects, teamId: string | null = null): FocusTarget {
  if (teamId !== null) return { projectId: null, teamId };
  const single = selectSingleFocusProject(selection);
  if (single !== null || selection.projectIds.length === 0) return { projectId: single, teamId: null };
  return { projectId: null, projectIds: selection.projectIds, except: selection.except, teamId: null };
}

export function resolveKeptUntil(state: ShinsaState, now = Date.now()) {
  const { until } = state.focus;
  return until !== null && until > now ? until : null;
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

export function selectFocusInitiative(state: ShinsaState, now = Date.now()) {
  const initiativeId = resolveFocusInitiative(state, now);
  return initiativeId === null ? null : (state.initiatives[initiativeId] ?? null);
}
