import { describe, expect, it } from 'bun:test';
import type { Command } from '@/lib/command/registry.ts';
import { applySearch, listTaskListSections } from '@/lib/command/tasks.ts';
import { navigate } from '@/router.ts';

function commandsOf(search: string, status: Parameters<typeof listTaskListSections>[1]) {
  return listTaskListSections(search, status)[0]?.commands ?? [];
}

function find(commands: Command[], id: string) {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

describe('listTaskListSections', () => {
  it('offers a status filter and the search without filters set', () => {
    const [section] = listTaskListSections('', null);
    expect(section).toMatchObject({ id: 'tasks.filters', heading: 'Filters', rank: 0 });
    const commands = section?.commands ?? [];
    expect(commands.map((command) => command.id)).toEqual(['tasks.status', 'tasks.search']);
    const status = find(commands, 'tasks.status');
    if (status.kind !== 'choice') throw new Error('Expected a choice');
    expect(status).toMatchObject({ hint: 'Any status', value: 'any' });
    expect(status.options[0]).toMatchObject({ value: 'any', label: 'Any status' });
    expect(status.options.map((option) => option.label)).toContain('Ready to merge');
  });

  it('names the active status and offers Clear filters first', () => {
    const commands = commandsOf('', 'review');
    expect(commands.map((command) => command.id)).toEqual(['tasks.clear', 'tasks.status', 'tasks.search']);
    expect(find(commands, 'tasks.status')).toMatchObject({ hint: 'Changes to review', value: 'review' });
    expect(commandsOf('login', null)[0]?.id).toBe('tasks.clear');
  });

  it('filters by status in the URL', () => {
    navigate('/tasks?q=login');
    const status = find(commandsOf('login', null), 'tasks.status');
    if (status.kind !== 'choice') throw new Error('Expected a choice');
    status.pick('merge');
    expect(location.search).toBe('?q=login&status=merge');
    status.pick('any');
    expect(location.search).toBe('?q=login');
  });

  it('clears the search and the status', () => {
    navigate('/tasks?q=login&status=merge&layout=cards');
    const clear = find(commandsOf('login', 'merge'), 'tasks.clear');
    if (clear.kind === 'run') clear.run();
    expect(location.search).toBe('?layout=cards');
  });

  it('types the query into the page search', () => {
    navigate('/tasks');
    const search = find(commandsOf('', null), 'tasks.search');
    if (search.kind !== 'search') throw new Error('Expected a search');
    const before = history.length;
    search.search('login');
    expect(location.search).toBe('?q=login');
    expect(history.length).toBe(before);
  });
});

describe('applySearch', () => {
  it('removes the query when the search is emptied', () => {
    navigate('/tasks?q=login&status=done');
    applySearch('');
    expect(location.search).toBe('?status=done');
  });
});
