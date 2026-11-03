import { describe, expect, it } from 'bun:test';
import type { Command } from '@/lib/command/registry.ts';
import {
  applyFilterValues,
  applySearch,
  clearTaskFilters,
  listTaskListSections,
  toggleTaskFilter,
} from '@/lib/command/tasks.ts';
import { NO_TASK_FILTERS, type TaskFilterField, type TaskFilters } from '@/lib/tasks/filters.ts';
import { navigate } from '@/router.ts';

const STATUS: TaskFilterField = {
  key: 'status',
  label: 'Status',
  icon: 'IconListBullets',
  options: [
    { value: 'merge', label: 'Ready to merge', icon: 'IconMerged', count: 2 },
    { value: 'done', label: 'Done', icon: 'IconCheckCircle2', count: 1 },
  ],
};

const OWNER: TaskFilterField = {
  key: 'owner',
  label: 'Owner',
  icon: 'IconUser',
  options: [
    { value: 'you', label: 'You', count: 3 },
    { value: 'kai', label: 'Kai', count: 1 },
  ],
};

function filtersOf(overrides: Partial<TaskFilters> = {}): TaskFilters {
  return { ...NO_TASK_FILTERS, ...overrides };
}

function commandsOf(filters: TaskFilters, fields = [STATUS, OWNER]) {
  return listTaskListSections(filters, fields)[0]?.commands ?? [];
}

function find(commands: Command[], id: string) {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

function choice(commands: Command[], id: string) {
  const command = find(commands, id);
  if (command.kind !== 'choice') throw new Error('Expected a choice');
  return command;
}

describe('listTaskListSections', () => {
  it('offers a filter for each field and the search without filters set', () => {
    const [section] = listTaskListSections(filtersOf(), [STATUS, OWNER]);
    expect(section).toMatchObject({ id: 'tasks.filters', heading: 'Filters', rank: 0 });
    const commands = section?.commands ?? [];
    expect(commands.map((command) => command.id)).toEqual([
      'tasks.filter.status',
      'tasks.filter.owner',
      'tasks.search',
    ]);
    const status = choice(commands, 'tasks.filter.status');
    expect(status).toMatchObject({ label: 'Filter by status', hint: 'Any status', value: ['any'] });
    expect(status.options.map((option) => option.label)).toEqual(['Any status', 'Ready to merge', 'Done']);
    const owner = choice(commands, 'tasks.filter.owner');
    expect(owner.options[1]).toEqual({ value: 'you', label: 'You' });
  });

  it('names the chosen values and offers Clear filters first', () => {
    const commands = commandsOf(filtersOf({ status: ['merge', 'done'] }));
    expect(commands[0]?.id).toBe('tasks.clear');
    expect(find(commands, 'tasks.filter.status')).toMatchObject({
      hint: 'Ready to merge, Done',
      value: ['merge', 'done'],
    });
    expect(commandsOf(filtersOf({ search: 'login' }))[0]?.id).toBe('tasks.clear');
  });

  it('toggles a value in the URL and Any clears the field', () => {
    navigate('/tasks?q=login&status=merge');
    const status = choice(
      commandsOf(filtersOf({ search: 'login', status: ['merge'] })),
      'tasks.filter.status'
    );
    status.pick('done');
    expect(location.search).toBe('?q=login&status=merge%2Cdone');
    status.pick('merge');
    expect(location.search).toBe('?q=login');
    navigate('/tasks?status=merge');
    status.pick('any');
    expect(location.search).toBe('');
  });

  it('clears the search and every filter, and keeps the rest of the URL', () => {
    navigate('/tasks?q=login&status=merge&owner=kai&layout=cards');
    const clear = find(commandsOf(filtersOf({ search: 'login', status: ['merge'] })), 'tasks.clear');
    if (clear.kind === 'run') clear.run();
    expect(location.search).toBe('?layout=cards');
  });

  it('types the query into the page search', () => {
    navigate('/tasks');
    const search = find(commandsOf(filtersOf()), 'tasks.search');
    if (search.kind !== 'search') throw new Error('Expected a search');
    const before = history.length;
    search.search('login');
    expect(location.search).toBe('?q=login');
    expect(history.length).toBe(before);
  });
});

describe('the filter writers', () => {
  it('removes the query when the search is emptied', () => {
    navigate('/tasks?q=login&status=done');
    applySearch('');
    expect(location.search).toBe('?status=done');
  });

  it('writes, toggles and clears filter values', () => {
    navigate('/tasks');
    applyFilterValues('repo', ['shinsa', 'paywall']);
    expect(location.search).toBe('?repo=shinsa%2Cpaywall');
    toggleTaskFilter(filtersOf({ repo: ['shinsa', 'paywall'] }), 'repo', 'shinsa');
    expect(location.search).toBe('?repo=paywall');
    applyFilterValues('repo', []);
    expect(location.search).toBe('');
    navigate('/tasks?kind=change&priority=high');
    clearTaskFilters();
    expect(location.search).toBe('');
  });
});
