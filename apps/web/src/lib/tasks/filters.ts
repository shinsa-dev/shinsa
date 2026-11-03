import {
  isListedInFocus,
  isTeamTask,
  isWatchHome,
  resolveFocusProject,
  resolveFocusTeam,
  resolveTaskProject,
  resolveTaskShape,
  type ShinsaState,
  TASK_PRIORITIES,
  TASK_SHAPES,
  type Task,
} from '@shinsa/core';
import type { FocusTeam } from '@/lib/focus.ts';
import { resolveTaskGroup, TASK_GROUPS, type TaskGroupKey, type TeamEntry } from '@/lib/tasks/groups.ts';

export const TASK_FILTER_KEYS = ['status', 'owner', 'team', 'project', 'repo', 'kind', 'priority'] as const;

export type TaskFilterKey = (typeof TASK_FILTER_KEYS)[number];

export type TaskFilters = Record<TaskFilterKey, readonly string[]> & { search: string };

export const YOUR_TASKS_OWNER = 'you';

export const NO_TASK_FILTERS: TaskFilters = {
  search: '',
  status: [],
  owner: [],
  team: [],
  project: [],
  repo: [],
  kind: [],
  priority: [],
};

const KNOWN_VALUES: Partial<Record<TaskFilterKey, ReadonlySet<string>>> = {
  status: new Set(TASK_GROUPS.map((group) => group.key)),
  kind: new Set(TASK_SHAPES),
  priority: new Set(TASK_PRIORITIES),
};

const VALUE_SEPARATOR = ',';

function parseFilterValues(key: TaskFilterKey, raw: string | null) {
  if (!raw) return [];
  const known = KNOWN_VALUES[key];
  const values = raw
    .split(VALUE_SEPARATOR)
    .map((value) => value.trim())
    .filter((value) => value !== '' && (!known || known.has(value)));
  return [...new Set(values)];
}

export function resolveTaskFilters(search: string): TaskFilters {
  const params = new URLSearchParams(search);
  const filters: TaskFilters = { ...NO_TASK_FILTERS, search: params.get('q') ?? '' };
  for (const key of TASK_FILTER_KEYS) filters[key] = parseFilterValues(key, params.get(key));
  return filters;
}

export function serializeFilterValues(values: readonly string[]) {
  return values.length > 0 ? values.join(VALUE_SEPARATOR) : null;
}

export function toggleFilterValue(values: readonly string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function countActiveFilters(filters: TaskFilters) {
  return TASK_FILTER_KEYS.reduce((count, key) => count + filters[key].length, 0);
}

export function isFiltering(filters: TaskFilters) {
  return filters.search.trim() !== '' || countActiveFilters(filters) > 0;
}

export function resolveClearedFilters(): Record<string, null> {
  return Object.fromEntries(['q', ...TASK_FILTER_KEYS].map((key) => [key, null]));
}

export interface TaskRow {
  task: Task;
  state: ShinsaState;
  group: TaskGroupKey;
  owner: string;
  teamIds: readonly string[];
  project: string | null;
  repo: string | null;
  team?: TeamEntry;
}

function resolveOwnRow(state: ShinsaState, task: Task, teams: readonly FocusTeam[]): TaskRow {
  const projectId = resolveTaskProject(state, task);
  return {
    task,
    state,
    group: resolveTaskGroup(state, task),
    owner: YOUR_TASKS_OWNER,
    teamIds: teams.filter((team) => isTeamTask(state, task, team.id)).map((team) => team.id),
    project: (projectId && state.projects[projectId]?.name) || null,
    repo: (task.repoId && state.repos[task.repoId]?.name) || null,
  };
}

function resolveTeamRow(team: TeamEntry): TaskRow {
  const { entry } = team;
  return {
    task: entry.task,
    state: team.state,
    group: resolveTaskGroup(team.state, entry.task),
    owner: entry.owner ?? entry.instanceId,
    teamIds: [entry.teamId],
    project: entry.project?.name ?? null,
    repo: entry.repo?.name ?? null,
    team,
  };
}

function isTeamRowInFocus(state: ShinsaState, team: TeamEntry, now: number) {
  const teamId = resolveFocusTeam(state, now);
  if (teamId !== null) return team.entry.teamId === teamId;
  const projectId = resolveFocusProject(state, now);
  return projectId === null || team.entry.project?.id === projectId;
}

export function listTaskRows(
  state: ShinsaState,
  team: readonly TeamEntry[],
  teams: readonly FocusTeam[],
  now = Date.now()
): TaskRow[] {
  const own = Object.values(state.tasks)
    .filter((task) => !isWatchHome(task) && isListedInFocus(state, task, now))
    .map((task) => resolveOwnRow(state, task, teams));
  const theirs = team.filter((entry) => isTeamRowInFocus(state, entry, now)).map(resolveTeamRow);
  return [...own, ...theirs];
}

function matchesSearch(row: TaskRow, needle: string) {
  const { task } = row;
  const people = row.team ? `${row.team.entry.owner ?? ''} ${row.team.entry.machine ?? ''}` : '';
  return `${task.title} ${task.request} ${task.branch ?? ''} ${row.repo ?? ''} ${people}`
    .toLowerCase()
    .includes(needle);
}

function matchesAny(picked: readonly string[], values: readonly (string | null)[]) {
  return picked.length === 0 || values.some((value) => value !== null && picked.includes(value));
}

export function matchesTaskFilters(row: TaskRow, filters: TaskFilters) {
  const needle = filters.search.trim().toLowerCase();
  return (
    (needle === '' || matchesSearch(row, needle)) &&
    matchesAny(filters.status, [row.group]) &&
    matchesAny(filters.owner, [row.owner]) &&
    matchesAny(filters.team, row.teamIds) &&
    matchesAny(filters.project, [row.project]) &&
    matchesAny(filters.repo, [row.repo]) &&
    matchesAny(filters.kind, [resolveTaskShape(row.task)]) &&
    matchesAny(filters.priority, [row.task.priority])
  );
}

export function filterTaskRows(rows: readonly TaskRow[], filters: TaskFilters) {
  return rows.filter((row) => matchesTaskFilters(row, filters));
}
