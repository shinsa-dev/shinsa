import { describe, expect, test } from 'bun:test';
import type { SuggestedTask } from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  registerRepo,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

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

  test('accepting, dismissing or keeping one in its task is kept in your decision profile', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Cache the session'), suggestion('Retry the export')]);
    const [first, second] = harness.task(taskId).suggestions ?? [];
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: first?.id ?? '' });
    harness.send({ type: 'suggestion.keep', taskId, suggestionId: second?.id ?? '' });
    expect(
      harness.state.autopilotProfile.decisions
        .filter((entry) => entry.kind === 'suggestion')
        .map((entry) => [entry.kind, entry.answer, entry.note])
    ).toEqual([
      ['suggestion', 'dismissed', 'Cache the session'],
      ['suggestion', 'kept', 'Retry the export'],
    ]);
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
    ).toThrow('It was already added or dismissed.');
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
    ).toThrow('That task was cancelled.');
  });

  test('an agent suggests a task bundled with this one, and accepting it stacks the new task on this one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    suggest(harness, taskId, [
      { ...suggestion('Split the export'), stacksOnThis: true },
      suggestion('Retry the export'),
    ]);
    const [bundled, plain] = harness.task(taskId).suggestions ?? [];
    if (!bundled || !plain) throw new Error('no suggestions');
    expect(bundled).toMatchObject({ stacksOnThis: true, waitsOnThis: false });
    expect(plain.stacksOnThis).toBeUndefined();
    harness.send({
      type: 'suggestion.accept',
      taskId,
      suggestionId: bundled.id,
      waitsOnThis: false,
      stackOnThis: true,
    });
    const created = harness.task(harness.task(taskId).suggestions?.[0]?.createdTaskId ?? '');
    expect(created).toMatchObject({ stacksOn: [taskId], waitsOn: [], repoId: harness.task(taskId).repoId });
  });

  test('a bundled suggestion cannot also wait for the merge, nor bundle with a task that opens no pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() =>
      suggest(harness, taskId, [{ ...suggestion('Split the export', true), stacksOnThis: true }])
    ).toThrow('Set stack_on_this or after_this, not both');
    expect(harness.task(taskId).suggestions ?? []).toEqual([]);

    const repoId = registerRepo(harness, 'answers');
    harness.send({ type: 'task.create', request: 'How does the export retry?', repoId: null, mode: 'ask' });
    const question = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({
      type: 'task.triage',
      taskId: question,
      title: 'How the export retries',
      repoId,
      size: 'small',
      branch: 'ask/export-retry',
      waitsOn: [],
    });
    verifySetup(harness, question);
    expect(() =>
      suggest(harness, question, [{ ...suggestion('Split the export'), stacksOnThis: true }])
    ).toThrow('This task opens no pull request, so nothing can be bundled with it.');
    suggest(harness, question, [suggestion('Split the export')]);
    expect(harness.task(question).suggestions).toHaveLength(1);
  });

  test('accepting takes one way to start, and a finished task has nothing to bundle with', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    suggest(harness, taskId, [suggestion('Split the export')]);
    const id = harness.task(taskId).suggestions?.[0]?.id ?? '';
    for (const other of [{ waitsOnThis: true }, { waitsOnThis: false, backlog: true }]) {
      expect(() =>
        harness.send({ type: 'suggestion.accept', taskId, suggestionId: id, stackOnThis: true, ...other })
      ).toThrow('Pick one way to start it');
    }
    expect(harness.task(taskId).suggestions?.[0]?.status).toBe('open');

    const merged = createTask(harness, { request: 'Merged' });
    suggest(harness, merged, [suggestion('After merge')]);
    shipAndMerge(harness, merged);
    const after = harness.task(merged).suggestions?.[0]?.id ?? '';
    expect(() =>
      harness.send({
        type: 'suggestion.accept',
        taskId: merged,
        suggestionId: after,
        waitsOnThis: false,
        stackOnThis: true,
      })
    ).toThrow('That task is finished, so there is nothing to stack on.');
    expect(harness.task(merged).suggestions?.[0]?.status).toBe('open');
  });
});
