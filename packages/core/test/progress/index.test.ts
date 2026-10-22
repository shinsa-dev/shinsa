import { describe, expect, test } from 'bun:test';
import { resolveTaskProgress, type Task } from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  proposePlan,
  reachReviewGate,
  shipAndMerge,
} from '../harness.ts';

function statuses(task: Task) {
  return resolveTaskProgress(task).phases.map((phase) => `${phase.key}:${phase.status}`);
}

describe('resolveTaskProgress', () => {
  test('before a plan the build is one step, and planning is the current one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(statuses(harness.task(taskId))).toEqual([
      'plan:active',
      'build:pending',
      'check:pending',
      'review:pending',
      'pull-request:pending',
      'merge:pending',
    ]);
    expect(resolveTaskProgress(harness.task(taskId))).toMatchObject({ position: 1, total: 6, done: 0 });
  });

  test('each planned phase is a step, and the one being built is current', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    const progress = resolveTaskProgress(harness.task(taskId));
    expect(statuses(harness.task(taskId)).slice(0, 3)).toEqual(['plan:done', 'plan-0:done', 'plan-1:active']);
    expect(progress.current?.title).toBe('Fix and verify');
    expect(progress.current?.planned).toBe(true);
    expect(progress.position).toBe(3);
  });

  test('the first pending phase is current while building when none is marked active', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const task = harness.task(taskId);
    const idle = { ...task, phases: task.phases.map((phase) => ({ ...phase, status: 'pending' as const })) };
    expect(statuses(idle).slice(1, 3)).toEqual(['plan-0:active', 'plan-1:pending']);
  });

  test('a decision waiting on you is shown as waiting, not active', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const progress = resolveTaskProgress(harness.task(taskId));
    expect(progress.current).toMatchObject({ key: 'review', status: 'waiting' });
    expect(statuses(harness.task(taskId))).toContain('check:done');
  });

  test('skipped phases stay skipped after building, and count as done', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    const skipped = { ...task, phases: [{ status: 'skipped' as const, at: 0 }, ...task.phases.slice(1)] };
    expect(statuses(skipped).slice(1, 3)).toEqual(['plan-0:skipped', 'plan-1:done']);
  });

  test('a merged task has every step done and no current step', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    const progress = resolveTaskProgress(harness.task(taskId));
    expect(progress.current).toBeNull();
    expect(progress.done).toBe(progress.total);
    expect(progress.position).toBe(progress.total);
  });

  test('a waiting task says what it waits for, and a cancelled one shows nothing done', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    const child = createTask(harness, { intent: 'Child', blockedBy: [parent] });
    expect(resolveTaskProgress(harness.task(child)).phases[0]).toMatchObject({
      status: 'pending',
      detail: 'Starts when the task it waits on finishes',
    });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(resolveTaskProgress(harness.task(parent)).done).toBe(0);
  });
});
