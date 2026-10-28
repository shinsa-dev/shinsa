import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MemoryEntry } from '@shinsa/core';
import {
  describeProposal,
  describeRuleCount,
  describeRuleLength,
  describeRuleSubmit,
  describeScopeName,
  EVERY_PROJECT,
  listMemoryGroups,
  listScopeItems,
  MEMORY_ACTIONS,
  parseScopeValue,
  resolveScopeValue,
  validateRule,
} from '@/lib/memory.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createProject, createShinsaState } from '../support/state.ts';

function entry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    projectId: null,
    text: `Rule ${overrides.id}.`,
    why: null,
    status: 'kept',
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const BILLING = createProject({ id: 'billing', name: 'Billing', color: 'green' });
const APP = createProject({ id: 'app', name: 'App', color: 'blue' });
const EMPTY = createProject({ id: 'empty', name: 'Empty' });

function stateWith(entries: MemoryEntry[]) {
  return createShinsaState({
    projects: [BILLING, APP, EMPTY],
    patch: { memories: Object.fromEntries(entries.map((item) => [item.id, item])) },
  });
}

describe('listMemoryGroups', () => {
  it('puts proposals first, then every project, then each project that has rules, by name', () => {
    const state = stateWith([
      entry({ id: 'b1', projectId: 'billing', createdAt: 3 }),
      entry({ id: 'g1', createdAt: 2 }),
      entry({ id: 'p1', status: 'proposed', projectId: 'app', createdAt: 4 }),
      entry({ id: 'a1', projectId: 'app', createdAt: 1 }),
    ]);
    const groups = listMemoryGroups(state);
    expect(groups.proposals.map((item) => item.id)).toEqual(['p1']);
    expect(
      groups.scopes.map((scope) => [scope.project?.name ?? null, scope.entries.map((item) => item.id)])
    ).toEqual([
      [null, ['g1']],
      ['App', ['a1']],
      ['Billing', ['b1']],
    ]);
  });

  it('keeps the every-project block even when it is empty', () => {
    expect(listMemoryGroups(stateWith([])).scopes).toEqual([{ project: null, entries: [] }]);
  });
});

describe('scopes', () => {
  it('offers every project first, then each project with its colour', () => {
    expect(listScopeItems(stateWith([]))).toEqual([
      { value: EVERY_PROJECT, label: 'Every project' },
      { value: 'app', label: 'App', dot: 'blue' },
      { value: 'billing', label: 'Billing', dot: 'green' },
      { value: 'empty', label: 'Empty', dot: 'blue' },
    ]);
  });

  it('turns a scope into a select value and back', () => {
    expect(resolveScopeValue(null)).toBe(EVERY_PROJECT);
    expect(resolveScopeValue('app')).toBe('app');
    expect(parseScopeValue(EVERY_PROJECT)).toBeNull();
    expect(parseScopeValue('app')).toBe('app');
  });

  it('names a scope, and a project that is gone', () => {
    const state = stateWith([]);
    expect(describeScopeName(state, null)).toBe('Every project');
    expect(describeScopeName(state, 'billing')).toBe('Billing');
    expect(describeScopeName(state, 'gone')).toBe('A removed project');
  });

  it('describes a proposal with where it applies and why', () => {
    const state = stateWith([]);
    expect(describeProposal(state, entry({ id: 'p', projectId: 'app', why: 'You asked twice.' }))).toBe(
      'App · You asked twice.'
    );
    expect(describeProposal(state, entry({ id: 'p' }))).toBe('Every project');
  });

  it('names the form’s button for a new rule, a proposal and a kept rule', () => {
    expect(describeRuleSubmit(null, false)).toBe('Add rule');
    expect(describeRuleSubmit('p1', true)).toBe('Keep');
    expect(describeRuleSubmit('m1', false)).toBe('Save');
  });

  it('counts the rules against the limit', () => {
    expect(describeRuleCount(3)).toBe('3 of 20');
    expect(describeRuleLength('  Keep plans short.  ')).toBe('17 / 240');
  });
});

describe('validateRule', () => {
  it('needs a rule and keeps it short', () => {
    expect(validateRule('   ')).toBe('Write the rule for agents to follow.');
    expect(validateRule('x'.repeat(241))).toBe('Keep it to 240 characters. It has 241.');
    expect(validateRule(' Keep plans short. ')).toBeNull();
  });
});

describe('MEMORY_ACTIONS', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('writes, keeps, removes and dismisses with a toast each', async () => {
    await MEMORY_ACTIONS.write(null, 'app', 'Keep plans short.');
    await MEMORY_ACTIONS.write('m1', null, 'Keep plans shorter.');
    await MEMORY_ACTIONS.keep(entry({ id: 'p1', status: 'proposed' }));
    await MEMORY_ACTIONS.remove(entry({ id: 'm1' }));
    await MEMORY_ACTIONS.remove(entry({ id: 'p1', status: 'proposed' }));
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'memory.write', memoryId: null, projectId: 'app', text: 'Keep plans short.' },
        'Agents follow it from their next turn.',
      ],
      [{ type: 'memory.write', memoryId: 'm1', projectId: null, text: 'Keep plans shorter.' }, 'Rule saved.'],
      [{ type: 'memory.accept', memoryId: 'p1' }, 'Kept. Agents follow it from their next turn.'],
      [{ type: 'memory.remove', memoryId: 'm1' }, 'Agents no longer follow it.'],
      [{ type: 'memory.remove', memoryId: 'p1' }, 'Dismissed.'],
    ]);
  });
});
