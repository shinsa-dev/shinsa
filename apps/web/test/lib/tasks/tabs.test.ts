import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import {
  CODE_MODE,
  hasChanges,
  hasReview,
  listCodeModes,
  listTaskTabs,
  resolveTaskTab,
  TASK_TAB,
} from '@/lib/tasks/tabs.ts';
import { createTask } from '../../support/state.ts';

const FIX = [
  'investigate',
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
] as const;

describe('listTaskTabs', () => {
  it('shows the code tab for any task with a repository, and for one with changes', () => {
    expect(listTaskTabs(createTask({ id: 't', stage: 'planning', repoId: 'r' }))).toEqual([
      'overview',
      'code',
      'chat',
    ]);
    expect(listTaskTabs(createTask({ id: 't', stage: 'done', mode: 'ask', repoId: 'r' }))).toEqual([
      'overview',
      'code',
      'chat',
    ]);
    expect(listTaskTabs(createTask({ id: 't', stage: 'building' }))).toEqual(['overview', 'code', 'chat']);
  });

  it('has no code tab before triage finds a repository', () => {
    for (const stage of ['triage', 'waiting_on_tasks', 'planning', 'awaiting_plan'] as const) {
      expect(listTaskTabs(createTask({ id: 't', stage }))).toEqual(['overview', 'chat']);
    }
  });
});

describe('the Review tab', () => {
  const report = { headline: '', sections: [], checks: [], judgementCalls: [] } as NonNullable<
    Task['report']
  >;

  it('comes before Code once there is something to review: a report, findings or a review gate', () => {
    expect(listTaskTabs(createTask({ id: 't', stage: 'building', report }))).toEqual([
      'overview',
      'review',
      'code',
      'chat',
    ]);
    const finding = { severity: 'blocking' as const, file: null, line: null, message: 'm' };
    expect(hasReview(createTask({ id: 't', stage: 'fixing', findings: [finding] }))).toBe(true);
    for (const stage of ['awaiting_review', 'shipping', 'awaiting_merge', 'merged', 'done'] as const) {
      expect(hasReview(createTask({ id: 't', stage }))).toBe(true);
    }
  });

  it('is not there while the agent still builds, nor for a task that builds nothing', () => {
    expect(hasReview(createTask({ id: 't', stage: 'building' }))).toBe(false);
    expect(hasReview(createTask({ id: 't', stage: 'done', pipeline: ['research'] }))).toBe(false);
  });
});

describe('listCodeModes', () => {
  it('lists changes once a task builds, and browses files before that', () => {
    expect(listCodeModes(createTask({ id: 't', stage: 'building' }))).toEqual(['changes', 'files']);
    expect(listCodeModes(createTask({ id: 't', stage: 'planning' }))).toEqual(['files']);
    expect(listCodeModes(createTask({ id: 't', stage: 'done', mode: 'ask' }))).toEqual(['files']);
  });

  it('a kind of task that builds nothing never has changes; find and fix has them once it builds', () => {
    for (const pipeline of [['investigate'], ['research'], ['plan', 'operate']] as const) {
      expect(hasChanges(createTask({ id: 't', stage: 'done', pipeline: [...pipeline] }))).toBe(false);
    }
    expect(hasChanges(createTask({ id: 't', stage: 'investigating', pipeline: [...FIX] }))).toBe(false);
    expect(hasChanges(createTask({ id: 't', stage: 'building', pipeline: [...FIX] }))).toBe(true);
  });

  it('an early task that already has a report has changes', () => {
    const report = { headline: '', sections: [], checks: [], judgementCalls: [] } as NonNullable<
      Task['report']
    >;
    expect(hasChanges(createTask({ id: 't', stage: 'planning', report }))).toBe(true);
  });
});

describe('resolveTaskTab', () => {
  it('opens the asked-for tab when the task has it, the overview otherwise', () => {
    expect(resolveTaskTab('code', ['overview', 'code', 'chat'])).toBe('code');
    expect(resolveTaskTab('code', ['overview', 'chat'])).toBe('overview');
    expect(resolveTaskTab(null, ['overview', 'chat'])).toBe('overview');
  });

  it('labels every tab and code mode', () => {
    expect(Object.values(TASK_TAB).map((tab) => tab.label)).toEqual(['Overview', 'Review', 'Code', 'Chat']);
    expect(Object.values(CODE_MODE).map((mode) => mode.label)).toEqual(['Changes', 'Files', 'Search']);
  });
});
