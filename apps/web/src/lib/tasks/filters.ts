import {
  isListedInFocus,
  isTeamTask,
  isWatchHome,
  listProjectRepos,
  resolveFocusProjects,
  resolveFocusTeam,
  resolveTaskProject,
  resolveTaskShape,
  type ShinsaState,
  TASK_PRIORITIES,
  TASK_SHAPES,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { type FocusTeam, UNNAMED_TEAM } from '@/lib/focus.ts';
import { PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveSharedProfile, type UserProfile } from '@/lib/remote/users.ts';
import { resolveTaskGroup, TASK_GROUPS, type TaskGroupKey, type TeamEntry } from '@/lib/tasks/groups.ts';
import { SHAPE_ICON, SHAPE_LABEL } from '@/lib/tasks/shapes.ts';
import { describeTeamTaskOwner } from '@/lib/teams/feeds.ts';

const TASK_FILTER_KEYS = ['status', 'owner', 'team', 'project', 'repo', 'kind', 'priority'] as const;

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

function isTeamRowInProject(state: ShinsaState, team: TeamEntry, projectId: string) {
  const { project, repo } = team.entry;
  const remote = repo?.remote?.toLowerCase();
  if (remote && listProjectRepos(state, projectId).some((own) => own.remote?.toLowerCase() === remote))
    return true;
  const name = state.projects[projectId]?.name.toLowerCase();
  return name !== undefined && project?.name.toLowerCase() === name;
}

function isTeamRowInFocus(state: ShinsaState, team: TeamEntry, now: number) {
  const teamId = resolveFocusTeam(state, now);
  if (teamId !== null) return team.entry.teamId === teamId;
  const { projectIds, except } = resolveFocusProjects(state, now);
  if (projectIds.length === 0) return true;
  const listed = projectIds.some((projectId) => isTeamRowInProject(state, team, projectId));
  return except ? !listed : listed;
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

function matchesTaskFilters(row: TaskRow, filters: TaskFilters) {
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

interface TaskFilterOption {
  value: string;
  label: string;
  icon?: MenuItemIcon;
  count: number;
  user?: UserProfile;
}

export interface TaskFilterField {
  key: TaskFilterKey;
  label: string;
  icon: IconName;
  options: TaskFilterOption[];
}

const FIELD_LABEL: Record<TaskFilterKey, { label: string; icon: IconName }> = {
  status: { label: 'Status', icon: 'IconListBullets' },
  owner: { label: 'Owner', icon: 'IconUser' },
  team: { label: 'Team', icon: 'IconUserDuo' },
  project: { label: 'Project', icon: 'IconFolder1' },
  repo: { label: 'Repository', icon: 'IconGithub' },
  kind: { label: 'Kind', icon: 'IconHammer' },
  priority: { label: 'Priority', icon: 'IconPriorityHigh' },
};

const YOU_LABEL = 'You';

const FIXED_OPTIONS: Partial<
  Record<TaskFilterKey, readonly { value: string; label: string; icon: MenuItemIcon }[]>
> = {
  status: TASK_GROUPS.map((group) => ({
    value: group.key,
    label: group.title,
    icon: { name: group.icon, className: TONE_TEXT[group.tone] },
  })),
  kind: TASK_SHAPES.map((shape) => ({ value: shape, label: SHAPE_LABEL[shape], icon: SHAPE_ICON[shape] })),
  priority: TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: PRIORITY_LABEL[priority],
    icon: PRIORITY_ICON[priority],
  })),
};

function listRowValues(row: TaskRow, key: TaskFilterKey): readonly (string | null)[] {
  if (key === 'status') return [row.group];
  if (key === 'owner') return [row.owner];
  if (key === 'team') return row.teamIds;
  if (key === 'project') return [row.project];
  if (key === 'repo') return [row.repo];
  if (key === 'kind') return [resolveTaskShape(row.task)];
  return [row.task.priority];
}

function describeOwner(rows: readonly TaskRow[], owner: string) {
  if (owner === YOUR_TASKS_OWNER) return YOU_LABEL;
  const entry = rows.find((row) => row.owner === owner)?.team?.entry;
  return entry ? describeTeamTaskOwner(entry) : owner;
}

function selectOwnerProfile(rows: readonly TaskRow[], owner: string) {
  const entry = rows.find((row) => row.owner === owner)?.team?.entry;
  return entry?.owner ? { user: resolveSharedProfile(entry.owner, entry.ownerProfile) } : {};
}

function describeValue(
  key: TaskFilterKey,
  value: string,
  rows: readonly TaskRow[],
  teams: readonly FocusTeam[]
) {
  if (key === 'owner') return describeOwner(rows, value);
  if (key === 'team') return teams.find((team) => team.id === value)?.name ?? UNNAMED_TEAM;
  return value;
}

function countValues(rows: readonly TaskRow[], key: TaskFilterKey) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of new Set(listRowValues(row, key))) {
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

function rankOption(key: TaskFilterKey, option: TaskFilterOption) {
  return key === 'owner' && option.value === YOUR_TASKS_OWNER ? 0 : 1;
}

function listFieldOptions(
  key: TaskFilterKey,
  rows: readonly TaskRow[],
  teams: readonly FocusTeam[],
  picked: readonly string[]
): TaskFilterOption[] {
  const counts = countValues(rows, key);
  const fixed = FIXED_OPTIONS[key];
  if (fixed) {
    return fixed
      .filter((option) => counts.has(option.value) || picked.includes(option.value))
      .map((option) => ({ ...option, count: counts.get(option.value) ?? 0 }));
  }
  const values = new Set([
    ...counts.keys(),
    ...picked,
    ...(key === 'team' ? teams.map((team) => team.id) : []),
  ]);
  return [...values]
    .map((value) => ({
      value,
      label: describeValue(key, value, rows, teams),
      count: counts.get(value) ?? 0,
      ...(key === 'owner' ? selectOwnerProfile(rows, value) : {}),
    }))
    .sort((a, b) => rankOption(key, a) - rankOption(key, b) || a.label.localeCompare(b.label));
}

export function listTaskFilterFields(
  rows: readonly TaskRow[],
  teams: readonly FocusTeam[],
  filters: TaskFilters,
  focusTeamId: string | null = null
): TaskFilterField[] {
  return TASK_FILTER_KEYS.map((key) => ({
    key,
    ...FIELD_LABEL[key],
    options: listFieldOptions(key, rows, teams, filters[key]),
  })).filter(
    (field) =>
      filters[field.key].length > 0 ||
      (field.options.length > 1 && !(field.key === 'team' && focusTeamId !== null))
  );
}

export function describeFilterChoice(field: TaskFilterField, picked: readonly string[]) {
  const labels = field.options
    .filter((option) => picked.includes(option.value))
    .map((option) => option.label);
  return labels.length > 0 ? labels.join(', ') : `Any ${field.label.toLowerCase()}`;
}
