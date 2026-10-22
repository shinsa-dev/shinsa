import { describe, expect, test } from 'bun:test';
import { findTask, resolveCurrentPhase, selectTask } from '../../src/index.ts';
import { buildAll, createHarness, createTask, registerRepo, shipAndMerge } from '../harness.ts';

describe('creating a task', () => {
  test('a task needs words and, when one is named, a repository that exists', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'task.create', intent: '  ', repoId: null })).toThrow(
      'Describe what you want done.'
    );
    expect(() => harness.send({ type: 'task.create', intent: 'Do it', repoId: 'nope' })).toThrow(
      'No repository nope'
    );
    expect(harness.state.tasks).toEqual({});
  });

  test('a new task is trimmed, titled from its first line and sent to triage', () => {
    const harness = createHarness();
    harness.send({
      type: 'task.create',
      intent: '  Fix the tabs\nThey scroll.  ',
      repoId: null,
      origin: '/code/x',
    });
    const [task] = Object.values(harness.state.tasks);
    expect(task).toMatchObject({
      intent: 'Fix the tabs\nThey scroll.',
      title: 'Fix the tabs',
      priority: 'normal',
      specFirst: false,
      origin: '/code/x',
      stage: 'triage',
    });
    expect(harness.lastEffect('task.triage').taskId).toBe(task?.id ?? '');
  });
});

describe('triage', () => {
  test('triage names a repository that exists and runs only once', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', intent: 'Fix it', repoId: null });
    const [taskId = ''] = Object.keys(harness.state.tasks);
    const triage = {
      type: 'task.triage' as const,
      taskId,
      title: 'Fix it',
      size: 'small' as const,
      branch: 'fix/it',
      dependsOn: [],
    };
    expect(() => harness.send({ ...triage, repoId: 'nope' })).toThrow('No repository nope');
    const repoId = registerRepo(harness);
    harness.send({ ...triage, repoId });
    const events = harness.state.seq;
    harness.send({ ...triage, repoId, title: 'Again' });
    expect(harness.state.seq).toBe(events);
    expect(harness.task(taskId)).toMatchObject({ title: 'Fix it', branch: 'fix/it', stage: 'triage' });
  });

  test('the classifier can only make a task wait on open tasks that do not wait on it', () => {
    const harness = createHarness();
    const done = createTask(harness, { intent: 'Done' });
    shipAndMerge(harness, done);
    const open = createTask(harness, { intent: 'Open' });
    const taskId = createTask(harness, { intent: 'New', dependsOn: [done, open, 'unknown', open] });
    expect(harness.task(taskId).blockedBy).toEqual([open]);
    expect(
      harness.task(taskId).activity.find((entry) => entry.actor === 'shinsa' && entry.kind === 'stage')
    ).toMatchObject({ text: 'Waits on “Open”' });
  });

  test('a worktree that is ready for a task that does not exist is refused', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'worktree.ready', taskId: 'nope', path: '/wt', branch: 'b' })).toThrow(
      'No task nope'
    );
  });

  test('a worktree that is gone is recorded once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId).worktreePath).toBeNull();
    const events = harness.state.seq;
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.state.seq).toBe(events);
  });
});

describe('priority', () => {
  test('a new priority reorders the guide, the same priority does nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const requests = harness.effectsOf('briefing.request').length;
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    expect(harness.task(taskId).priority).toBe('urgent');
    expect(harness.effectsOf('briefing.request')).toHaveLength(requests + 1);
    const events = harness.state.seq;
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    expect(harness.state.seq).toBe(events);
  });
});

describe('finished tasks', () => {
  test('a finished task takes no new dependencies and no failures', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const other = createTask(harness, { intent: 'Other' });
    harness.send({ type: 'task.complete', taskId });
    expect(() => harness.send({ type: 'task.block', taskId, blockedBy: [other] })).toThrow(
      'This task is finished.'
    );
    const events = harness.state.seq;
    harness.send({ type: 'effect.fail', taskId, title: 'Late', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.state.seq).toBe(events);
  });
});

describe('resolveCurrentPhase', () => {
  test('is the first phase without a report, or the last one when all are in', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const task = harness.task(taskId);
    expect(resolveCurrentPhase(task)).toBe(1);
    expect(resolveCurrentPhase({ ...task, phaseReports: task.phaseReports.slice(1) })).toBe(0);
    expect(resolveCurrentPhase({ ...task, spec: null, phaseReports: [] })).toBe(0);
  });
});

describe('a dependency added while the worktree is being made', () => {
  test('makes the task wait once its worktree is ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    harness.send({ type: 'task.create', intent: 'Child', repoId: harness.task(parent).repoId });
    const child = Object.keys(harness.state.tasks).find((id) => id !== parent) ?? '';
    harness.send({
      type: 'task.triage',
      taskId: child,
      title: 'Child',
      repoId: harness.task(parent).repoId ?? '',
      size: 'small',
      branch: 'fix/child',
      dependsOn: [],
    });
    harness.send({ type: 'task.block', taskId: child, blockedBy: [parent] });
    expect(harness.task(child).stage).toBe('triage');
    harness.send({ type: 'worktree.ready', taskId: child, path: '/wt/child', branch: 'fix/child' });
    expect(harness.task(child)).toMatchObject({
      stage: 'queued',
      stageReason: 'waiting for “Parent” to finish',
    });
  });
});

describe('looking up tasks', () => {
  test('select returns null for a task that does not exist, find throws', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(selectTask(harness.state, taskId)?.id).toBe(taskId);
    expect(selectTask(harness.state, 'nope')).toBeNull();
    expect(() => findTask(harness.state, 'nope')).toThrow('No task nope');
  });
});
