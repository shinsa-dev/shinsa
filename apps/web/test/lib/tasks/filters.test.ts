import { describe, expect, it } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import {
  countActiveFilters,
  describeFilterChoice,
  filterTaskRows,
  isFiltering,
  listTaskFilterFields,
  listTaskRows,
  NO_TASK_FILTERS,
  resolveClearedFilters,
  resolveTaskFilters,
  serializeFilterValues,
  type TaskFilterKey,
  type TaskFilters,
  toggleFilterValue,
  YOUR_TASKS_OWNER,
} from '@/lib/tasks/filters.ts';
import type { TeamEntry } from '@/lib/tasks/groups.ts';
import { resolveTeamTaskState } from '@/lib/teams/feeds.ts';
import {
  createGate,
  createProject,
  createRepo,
  createShinsaState,
  createTask,
  NOW,
} from '../../support/state.ts';
import { createTeamFeedTask } from '../teams/machine.ts';

const TEAMS = [
  { id: 'team1', name: 'Apps' },
  { id: 'team2', name: 'Platform' },
];

function teamEntry(overrides: Parameters<typeof createTeamFeedTask>[0]): TeamEntry {
  const entry = createTeamFeedTask(overrides);
  return { entry, state: resolveTeamTaskState(entry), heldAt: null };
}

const MINE = [
  createTask({ id: 'web', title: 'Billing page', repoId: 'paywall', priority: 'high' }),
  createTask({ id: 'api', title: 'Invoice export', projectId: 'core', branch: 'feat/invoices' }),
  createTask({ id: 'ask', title: 'Why is CI slow', projectId: 'core', mode: 'ask' }),
  createTask({ id: 'shipped', title: 'Old work', stage: 'merged', projectId: 'core' }),
  createTask({ id: 'home', stage: 'watching', watchHome: true }),
];

const STATE = createShinsaState({
  tasks: MINE,
  gates: [createGate({ id: 'g', taskId: 'web', type: 'review' })],
  repos: [
    createRepo({
      id: 'paywall',
      name: 'paywall-next',
      projectId: 'apps',
      remote: 'github.com/acme/paywall-next',
    }),
  ],
  projects: [
    createProject({ id: 'apps', name: 'Apps', teamIds: ['team1'] }),
    createProject({ id: 'core', name: 'Core', teamIds: ['team2'] }),
  ],
});

const KAI = teamEntry({
  task: createTask({ id: 'kai-task', title: 'Team billing', priority: 'urgent' }),
  project: createProject({ id: 'kai-apps', name: 'Apps' }),
  repo: createRepo({ id: 'r', name: 'paywall-next' }),
});

const LEE = teamEntry({
  task: createTask({ id: 'lee-task', title: 'Platform docs' }),
  teamId: 'team2',
  owner: 'lee',
  machine: 'Laptop',
  instanceId: 'l1',
});

const NOBODY = teamEntry({ task: createTask({ id: 'nobody' }), owner: null, instanceId: 'x9' });

const TEAM = [KAI, LEE, NOBODY];

function focused(focus: Partial<ShinsaState['focus']>): ShinsaState {
  return { ...STATE, focus: { projectIds: [], except: false, teamId: null, until: null, ...focus } };
}

function ids(state: ShinsaState, filters: Partial<TaskFilters> = {}) {
  return filterTaskRows(listTaskRows(state, TEAM, TEAMS, NOW), { ...NO_TASK_FILTERS, ...filters })
    .map((row) => (row.team ? `@${row.task.id}` : row.task.id))
    .sort();
}

describe('listTaskRows', () => {
  it('lists all your tasks and every team’s while nothing is in focus, leaving watch homes out', () => {
    expect(ids(STATE)).toEqual(['@kai-task', '@lee-task', '@nobody', 'api', 'ask', 'shipped', 'web']);
  });

  it('lists only the focused team’s tasks, yours and theirs', () => {
    expect(ids(focused({ teamId: 'team1' }))).toEqual(['@kai-task', '@nobody', 'web']);
    expect(ids(focused({ teamId: 'team2' }))).toEqual(['@lee-task', 'api', 'ask', 'shipped']);
  });

  it('lists only the focused project’s tasks, and a teammate’s only in that same project', () => {
    expect(ids(focused({ projectIds: ['apps'] }))).toEqual(['@kai-task', 'web']);
    expect(ids(focused({ projectIds: ['core'] }))).toEqual(['api', 'ask', 'shipped']);
  });

  it('lists the tasks of every project in focus, or of every project but those, teammates’ included', () => {
    expect(ids(focused({ projectIds: ['apps', 'core'] }))).toEqual([
      '@kai-task',
      'api',
      'ask',
      'shipped',
      'web',
    ]);
    expect(ids(focused({ projectIds: ['core'], except: true }))).toEqual([
      '@kai-task',
      '@lee-task',
      '@nobody',
      'web',
    ]);
  });

  it('matches a teammate’s row to your project by its repository’s remote, then by project name, never by id', () => {
    const state = focused({ projectIds: ['apps'] });
    const renamed = teamEntry({
      task: createTask({ id: 'same-repo' }),
      project: createProject({ id: 'p9', name: 'Billing' }),
      repo: createRepo({ id: 'r9', name: 'pw', remote: 'GitHub.com/acme/paywall-next' }),
    });
    const sameId = teamEntry({
      task: createTask({ id: 'same-id' }),
      project: createProject({ id: 'apps', name: 'Other' }),
    });
    const listed = listTaskRows(state, [renamed, sameId], TEAMS, NOW).map((row) => row.task.id);
    expect(listed).toContain('same-repo');
    expect(listed).not.toContain('same-id');
  });

  it('lists everything again once the focus is over', () => {
    expect(ids(focused({ teamId: 'team1', until: NOW - 1 }))).toHaveLength(7);
  });

  it('names each row’s owner, teams, project, repository and group', () => {
    const rows = listTaskRows(STATE, TEAM, TEAMS, NOW);
    const row = (id: string) => rows.find((entry) => entry.task.id === id);
    expect(row('web')).toMatchObject({
      owner: YOUR_TASKS_OWNER,
      teamIds: ['team1'],
      project: 'Apps',
      repo: 'paywall-next',
      group: 'review',
    });
    expect(row('api')).toMatchObject({ teamIds: ['team2'], project: 'Core', repo: null, group: 'working' });
    expect(row('kai-task')).toMatchObject({ owner: 'kai', teamIds: ['team1'], project: 'Apps' });
    expect(row('nobody')).toMatchObject({ owner: 'x9', project: null, repo: null });
  });

  it('gives a task in no team’s project no team', () => {
    const state = createShinsaState({ tasks: [createTask({ id: 'loose', repoId: 'gone' })] });
    expect(listTaskRows(state, [], TEAMS, NOW)[0]).toMatchObject({ teamIds: [], project: null, repo: null });
  });
});

describe('filterTaskRows', () => {
  it('keeps everything with no filters', () => {
    expect(ids(STATE, {})).toHaveLength(7);
  });

  it('filters by status group', () => {
    expect(ids(STATE, { status: ['review'] })).toEqual(['web']);
    expect(ids(STATE, { status: ['review', 'done'] })).toEqual(['shipped', 'web']);
  });

  it('filters by owner, you or a teammate', () => {
    expect(ids(STATE, { owner: [YOUR_TASKS_OWNER] })).toEqual(['api', 'ask', 'shipped', 'web']);
    expect(ids(STATE, { owner: ['lee', 'x9'] })).toEqual(['@lee-task', '@nobody']);
  });

  it('filters by team', () => {
    expect(ids(STATE, { team: ['team1'] })).toEqual(['@kai-task', '@nobody', 'web']);
  });

  it('filters by project and by repository name, across machines', () => {
    expect(ids(STATE, { project: ['Apps'] })).toEqual(['@kai-task', 'web']);
    expect(ids(STATE, { repo: ['paywall-next'] })).toEqual(['@kai-task', 'web']);
  });

  it('filters by kind of task', () => {
    expect(ids(STATE, { kind: ['answer'] })).toEqual(['ask']);
  });

  it('filters by priority', () => {
    expect(ids(STATE, { priority: ['urgent', 'high'] })).toEqual(['@kai-task', 'web']);
  });

  it('combines filters, every one having to match', () => {
    expect(ids(STATE, { project: ['Apps'], owner: [YOUR_TASKS_OWNER] })).toEqual(['web']);
  });

  it('searches title, request, branch, repository and a teammate’s name and machine', () => {
    expect(ids(STATE, { search: '  BILLING ' })).toEqual(['@kai-task', 'web']);
    expect(ids(STATE, { search: 'feat/invoices' })).toEqual(['api']);
    expect(ids(STATE, { search: 'paywall-next' })).toEqual(['@kai-task', 'web']);
    expect(ids(STATE, { search: 'laptop' })).toEqual(['@lee-task']);
  });
});

describe('resolveTaskFilters', () => {
  it('reads every filter from the address, comma separated, dropping unknown and repeated values', () => {
    const filters = resolveTaskFilters(
      '?q=bill&status=review,nope,review&owner=you,kai&team=team1&project=Apps&repo=paywall-next&kind=fix,bogus&priority=high,meh'
    );
    expect(filters).toEqual({
      search: 'bill',
      status: ['review'],
      owner: ['you', 'kai'],
      team: ['team1'],
      project: ['Apps'],
      repo: ['paywall-next'],
      kind: ['fix'],
      priority: ['high'],
    });
  });

  it('reads an empty address as no filters', () => {
    expect(resolveTaskFilters('')).toEqual(NO_TASK_FILTERS);
    expect(resolveTaskFilters('?owner=,%20')).toEqual(NO_TASK_FILTERS);
  });
});

describe('the filter helpers', () => {
  it('writes values back for the address, or removes the parameter when none is left', () => {
    expect(serializeFilterValues(['you', 'kai'])).toBe('you,kai');
    expect(serializeFilterValues([])).toBeNull();
  });

  it('toggles a value on and off', () => {
    expect(toggleFilterValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFilterValue(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('counts the active filters and knows when the list is narrowed', () => {
    const filters = { ...NO_TASK_FILTERS, owner: ['you', 'kai'], kind: ['fix'] };
    expect(countActiveFilters(filters)).toBe(3);
    expect(isFiltering(filters)).toBe(true);
    expect(isFiltering({ ...NO_TASK_FILTERS, search: '  ' })).toBe(false);
    expect(isFiltering({ ...NO_TASK_FILTERS, search: 'x' })).toBe(true);
  });

  it('clears the search and every filter', () => {
    expect(resolveClearedFilters()).toEqual({
      q: null,
      status: null,
      owner: null,
      team: null,
      project: null,
      repo: null,
      kind: null,
      priority: null,
    });
  });
});

function fields(filters: Partial<TaskFilters> = {}, team = TEAM, teams = TEAMS) {
  const all = { ...NO_TASK_FILTERS, ...filters };
  return listTaskFilterFields(listTaskRows(STATE, team, teams, NOW), teams, all);
}

function field(key: TaskFilterKey, list = fields()) {
  const found = list.find((entry) => entry.key === key);
  if (!found) throw new Error(`No field ${key}`);
  return found;
}

describe('listTaskFilterFields', () => {
  it('offers each field that can narrow the list, with the values the rows have and their counts', () => {
    const list = fields();
    expect(list.map((entry) => entry.label)).toEqual([
      'Status',
      'Owner',
      'Team',
      'Project',
      'Kind',
      'Priority',
    ]);
    expect(field('status', list).options.map(({ label, count }) => `${label} ${count}`)).toEqual([
      'Changes to review 1',
      'In progress 5',
      'Done 1',
    ]);
    expect(
      field('owner', list).options.map(({ value, label, count }) => `${value}:${label} ${count}`)
    ).toEqual(['you:You 4', 'kai:kai 1', 'lee:lee 1', 'x9:Studio 1']);
    expect(field('team', list).options.map(({ label, count }) => `${label} ${count}`)).toEqual([
      'Apps 3',
      'Platform 4',
    ]);
    expect(field('kind', list).options.map((option) => option.value)).toEqual(['answer', 'change']);
    expect(field('priority', list).options.map((option) => option.label)).toEqual([
      'Urgent',
      'High',
      'Normal',
    ]);
  });

  it('leaves out the team field while a team is in focus, unless it is filtered on', () => {
    const all = { ...NO_TASK_FILTERS };
    const rows = listTaskRows(STATE, TEAM, TEAMS, NOW);
    const inFocus = listTaskFilterFields(rows, TEAMS, all, 'apps');
    expect(inFocus.some((entry) => entry.key === 'team')).toBe(false);
    const kept = listTaskFilterFields(rows, TEAMS, { ...all, team: ['apps'] }, 'apps');
    expect(kept.some((entry) => entry.key === 'team')).toBe(true);
  });

  it('leaves out a field with one value, unless it is filtered on', () => {
    expect(fields().some((entry) => entry.key === 'repo')).toBe(false);
    const repo = field('repo', fields({ repo: ['paywall-next', 'gone'] }));
    expect(repo.options.map(({ value, count }) => `${value} ${count}`)).toEqual(['gone 0', 'paywall-next 2']);
  });

  it('keeps a filtered status that no row has, and every team you are in', () => {
    expect(field('status', fields({ status: ['merge'] })).options[0]).toMatchObject({
      value: 'merge',
      count: 0,
    });
    const teams = [...TEAMS, { id: 'team3', name: 'Design' }];
    expect(field('team', fields({}, TEAM, teams)).options.map((option) => option.label)).toEqual([
      'Apps',
      'Design',
      'Platform',
    ]);
  });

  it('names a team it no longer knows and an owner it has no row for', () => {
    const list = fields({ team: ['old'], owner: ['ghost'] });
    expect(field('team', list).options.find((option) => option.value === 'old')?.label).toBe('Your team');
    expect(field('owner', list).options.find((option) => option.value === 'ghost')?.label).toBe('ghost');
  });

  it('offers no owner or team with only your own tasks and no teams', () => {
    const keys = fields({}, [], []).map((entry) => entry.key);
    expect(keys).not.toContain('owner');
    expect(keys).not.toContain('team');
  });
});

describe('describeFilterChoice', () => {
  it('names the chosen values, or any', () => {
    const status = field('status');
    expect(describeFilterChoice(status, ['review', 'done'])).toBe('Changes to review, Done');
    expect(describeFilterChoice(status, [])).toBe('Any status');
  });
});
