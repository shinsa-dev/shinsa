import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { CODE_VIEW, listTaskTabs, resolveCodeView, resolveTaskTab, TASK_TAB } from '@/lib/tasks/tabs.ts';
import { createTask } from '../../support/state.ts';

describe('listTaskTabs', () => {
  it('hides the code tab until there is code to look at', () => {
    for (const stage of ['triage', 'queued', 'planning', 'awaiting_plan'] as const) {
      expect(listTaskTabs(createTask({ id: 't', stage }))).toEqual(['overview', 'chat']);
    }
    expect(listTaskTabs(createTask({ id: 't', stage: 'building' }))).toEqual(['overview', 'code', 'chat']);
  });

  it('never shows a code tab for a question, which changes no code', () => {
    expect(listTaskTabs(createTask({ id: 't', stage: 'done', mode: 'ask' }))).toEqual(['overview', 'chat']);
  });

  it('shows no code tab for a kind of task that builds nothing, and none for find and fix before it builds', () => {
    for (const pipeline of [['investigate'], ['research'], ['plan', 'operate']] as const) {
      expect(listTaskTabs(createTask({ id: 't', stage: 'done', pipeline: [...pipeline] }))).toEqual([
        'overview',
        'chat',
      ]);
    }
    const fix = [
      'investigate',
      'plan',
      'build',
      'checks',
      'agent_review',
      'your_review',
      'pull_request',
      'merge',
    ] as const;
    expect(listTaskTabs(createTask({ id: 't', stage: 'investigating', pipeline: [...fix] }))).toEqual([
      'overview',
      'chat',
    ]);
    expect(listTaskTabs(createTask({ id: 't', stage: 'building', pipeline: [...fix] }))).toEqual([
      'overview',
      'code',
      'chat',
    ]);
  });

  it('shows the code tab for an early task that already has a report', () => {
    const report = { headline: '', phases: [], checks: [], decisions: [] } as NonNullable<Task['report']>;
    expect(listTaskTabs(createTask({ id: 't', stage: 'planning', report }))).toEqual([
      'overview',
      'code',
      'chat',
    ]);
  });
});

describe('resolveTaskTab', () => {
  it('opens the asked-for tab when the task has it, the overview otherwise', () => {
    expect(resolveTaskTab('code', ['overview', 'code', 'chat'])).toBe('code');
    expect(resolveTaskTab('code', ['overview', 'chat'])).toBe('overview');
    expect(resolveTaskTab(null, ['overview', 'chat'])).toBe('overview');
    expect(resolveTaskTab('settings', ['overview', 'chat'])).toBe('overview');
  });

  it('labels every tab', () => {
    expect(TASK_TAB.overview.label).toBe('Overview');
    expect(TASK_TAB.code.label).toBe('Code');
    expect(TASK_TAB.chat.label).toBe('Chat');
  });

  it('labels both code views', () => {
    expect(CODE_VIEW.review.label).toBe('Guided review');
    expect(CODE_VIEW.changes.label).toBe('All files');
  });
});

describe('resolveCodeView', () => {
  it('shows the review unless all changes are asked for', () => {
    expect(resolveCodeView('changes')).toBe('changes');
    expect(resolveCodeView('review')).toBe('review');
    expect(resolveCodeView(null)).toBe('review');
  });
});
