import { describe, expect, test } from 'bun:test';
import type { SuggestedTask } from '../../src/index.ts';
import { createHarness, createTask, type Harness, shipAndMerge } from '../harness.ts';

function suggestion(title: string, waitsOnThis = false): SuggestedTask {
  return {
    title,
    request: `${title}, because the review found it.`,
    why: 'It came up while building.',
    waitsOnThis,
  };
}

function suggest(harness: Harness, taskId: string, suggestions: SuggestedTask[]) {
  return harness.send({ type: 'agent.suggest_tasks', runId: harness.activeRun(taskId).id, suggestions });
}

describe('suggested tasks', () => {
  test('an agent suggests tasks that wait for you, without starting anything', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    suggest(harness, taskId, [suggestion('Cache the session'), suggestion('Retry the export', true)]);
    expect(harness.task(taskId).suggestions).toMatchObject([
      { title: 'Cache the session', runId: run.id, status: 'open', waitsOnThis: false, createdTaskId: null },
      { title: 'Retry the export', waitsOnThis: true },
    ]);
    expect(Object.keys(harness.state.tasks)).toEqual([taskId]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      kind: 'suggestion',
      text: 'Suggested a task: Retry the export',
    });
  });

  test('a repeat of a known suggestion or an open task is dropped', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix the scroll' });
    suggest(harness, taskId, [suggestion('Cache the session')]);
    const repeat = suggest(harness, taskId, [
      suggestion('  cache   the SESSION '),
      suggestion('Fix the scroll'),
      suggestion('New one'),
      suggestion('new one'),
    ]);
    expect(repeat.events.filter((event) => event.type === 'task.suggested')).toHaveLength(1);
    expect(harness.task(taskId).suggestions?.map((item) => item.title)).toEqual([
      'Cache the session',
      'New one',
    ]);
  });

  test('a task holds at most ten open suggestions', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    suggest(
      harness,
      taskId,
      Array.from({ length: 5 }, (_, index) => suggestion(`A ${index}`))
    );
    suggest(
      harness,
      taskId,
      Array.from({ length: 5 }, (_, index) => suggestion(`B ${index}`))
    );
    expect(() => suggest(harness, taskId, [suggestion('C')])).toThrow(
      'This task already has 10 open suggestions.'
    );
  });

  test('accepting one creates the task in the same repository, waiting on this one when asked', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { priority: 'high' });
    suggest(harness, taskId, [suggestion('Cache the session'), suggestion('Retry the export')]);
    const [first, second] = harness.task(taskId).suggestions ?? [];
    if (!first || !second) throw new Error('no suggestions');
    harness.send({ type: 'suggestion.accept', taskId, suggestionId: first.id, waitsOnThis: true });
    const created = harness.task(taskId).suggestions?.[0]?.createdTaskId ?? '';
    expect(harness.task(created)).toMatchObject({
      request: 'Cache the session, because the review found it.',
      repoId: harness.task(taskId).repoId,
      priority: 'high',
      waitsOn: [taskId],
    });
    expect(harness.task(taskId).suggestions?.[0]?.status).toBe('accepted');
    expect(harness.lastEffect('task.triage').taskId).toBe(created);
    harness.send({ type: 'suggestion.accept', taskId, suggestionId: second.id, waitsOnThis: false });
    expect(harness.task(harness.task(taskId).suggestions?.[1]?.createdTaskId ?? '').waitsOn).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Added the suggested task “Retry the export”');
  });

  test('dismissing one closes it, and a closed suggestion cannot be decided again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Cache the session')]);
    const id = harness.task(taskId).suggestions?.[0]?.id ?? '';
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: id });
    expect(harness.task(taskId).suggestions?.[0]?.status).toBe('dismissed');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Dismissed the suggested task “Cache the session”'
    );
    expect(() =>
      harness.send({ type: 'suggestion.accept', taskId, suggestionId: id, waitsOnThis: false })
    ).toThrow('This suggestion has already been added or dismissed.');
    expect(() => harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: 'nope' })).toThrow(
      'No suggestion nope'
    );
  });

  test('a suggested task of a merged task starts at once, and one of a cancelled task cannot wait on it', () => {
    const harness = createHarness();
    const merged = createTask(harness, { request: 'Merged' });
    suggest(harness, merged, [suggestion('After merge')]);
    shipAndMerge(harness, merged);
    const after = harness.task(merged).suggestions?.[0]?.id ?? '';
    harness.send({ type: 'suggestion.accept', taskId: merged, suggestionId: after, waitsOnThis: true });
    expect(harness.task(harness.task(merged).suggestions?.[0]?.createdTaskId ?? '').waitsOn).toEqual([]);

    const cancelled = createTask(harness, { request: 'Cancelled' });
    suggest(harness, cancelled, [suggestion('After cancel')]);
    harness.send({ type: 'task.cancel', taskId: cancelled });
    const id = harness.task(cancelled).suggestions?.[0]?.id ?? '';
    expect(() =>
      harness.send({ type: 'suggestion.accept', taskId: cancelled, suggestionId: id, waitsOnThis: true })
    ).toThrow('was cancelled, so there is nothing to wait for.');
  });
});
