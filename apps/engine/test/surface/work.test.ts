import { describe, expect, setSystemTime, test } from 'bun:test';
import { MINUTE_MS } from '@shinsa/core';
import { createFakeClient, createTaskDetail, runSpec } from './fixtures.ts';

const DETAIL = createTaskDetail({
  suggestions: [
    { id: 'sug-1', title: 'Add a test', why: 'The scroll has none.', status: 'open', waitsOnThis: false },
    { id: 'sug-2', title: 'Clean up', why: 'Dead code.', status: 'accepted', waitsOnThis: true },
  ],
});

describe('suggested tasks', () => {
  test('lists the suggested tasks on a task, or says there are none', async () => {
    const fake = createFakeClient({ '/api/tasks/fix': DETAIL, '/api/tasks/other': createTaskDetail() });
    expect((await runSpec(fake, ['suggestions', 'list', 'fix'])).text).toBe(
      'sug-1  Add a test  (open) The scroll has none.\nsug-2  Clean up  (accepted) Dead code.'
    );
    expect((await runSpec(fake, ['suggestions', 'list', 'other'])).text).toBe('No suggested tasks.');
  });

  test('accepting adds it, after this task when asked; dismissing drops it', async () => {
    const fake = createFakeClient({ '/api/tasks/fix': DETAIL });
    expect((await runSpec(fake, ['suggestions', 'accept', 'fix', 'sug-1'])).text).toBe(
      'Added the suggested task.'
    );
    await runSpec(fake, ['suggestions', 'accept', 'fix', 'sug-2', '--after-this']);
    expect((await runSpec(fake, ['suggestions', 'dismiss', 'fix', 'sug-1'])).text).toBe('Dismissed.');
    expect((await runSpec(fake, ['suggestions', 'keep', 'fix', 'sug-1'])).text).toBe(
      'Kept it in this task as a new round.'
    );
    expect(fake.sent).toEqual([
      { type: 'suggestion.accept', taskId: 'task-123', suggestionId: 'sug-1', waitsOnThis: false },
      { type: 'suggestion.accept', taskId: 'task-123', suggestionId: 'sug-2', waitsOnThis: true },
      { type: 'suggestion.dismiss', taskId: 'task-123', suggestionId: 'sug-1' },
      { type: 'suggestion.keep', taskId: 'task-123', suggestionId: 'sug-1' },
    ]);
  });
});

describe('quiet runs', () => {
  test('snoozing lasts thirty minutes unless told otherwise, and dismissing ends the warning', async () => {
    setSystemTime(new Date(1_000_000));
    try {
      const fake = createFakeClient();
      expect((await runSpec(fake, ['runs', 'snooze', 'run-1'])).text).toBe('Snoozed.');
      await runSpec(fake, ['runs', 'snooze', 'run-1', '--minutes', '5']);
      expect((await runSpec(fake, ['runs', 'dismiss', 'run-1'])).text).toBe('Dismissed.');
      expect(fake.sent).toEqual([
        { type: 'run.snooze_silence', runId: 'run-1', until: 1_000_000 + 30 * MINUTE_MS },
        { type: 'run.snooze_silence', runId: 'run-1', until: 1_000_000 + 5 * MINUTE_MS },
        { type: 'run.dismiss_silence', runId: 'run-1' },
      ]);
    } finally {
      setSystemTime();
    }
  });
});

describe('delegations', () => {
  test('lists every delegation, or one task’s, with whether it is still working', async () => {
    const delegations = [
      {
        id: 'run-2',
        taskId: 'task-1',
        role: 'reviewer',
        outcome: null,
        endedAt: null,
        delegation: { title: 'Review it' },
      },
      {
        id: 'run-3',
        taskId: 'task-1',
        role: 'builder',
        outcome: 'completed',
        endedAt: 5,
        delegation: { title: 'Try it' },
      },
      { id: 'run-4', taskId: 'task-1', role: 'planner', outcome: null, endedAt: 6, delegation: null },
    ];
    const fake = createFakeClient({
      '/api/delegations': { delegations },
      '/api/delegations?task=Fix%20it': { delegations: [] },
    });
    expect((await runSpec(fake, ['delegations', 'list'])).text.split('\n')).toEqual([
      'run-2  reviewer  Review it  (working) on task task-1',
      'run-3  builder  Try it  (completed) on task task-1',
      'run-4  planner    (ended) on task task-1',
    ]);
    expect((await runSpec(fake, ['delegations', 'list', '--task', 'Fix it'])).text).toBe('No delegations.');
  });

  test('stopping one sends delegation.cancel for its run', async () => {
    const fake = createFakeClient();
    expect((await runSpec(fake, ['delegations', 'stop', 'run-2'])).text).toBe('Stopped.');
    expect(fake.sent).toEqual([{ type: 'delegation.cancel', runId: 'run-2' }]);
  });
});
