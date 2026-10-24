import { describe, expect, test } from 'bun:test';
import { type Round, resolveRoundProgress, resolveTaskProgress, type Task } from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  proposePlan,
  pullRequest,
  reachReviewGate,
  reachShipping,
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
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
    expect(resolveTaskProgress(harness.task(child)).phases[0]).toMatchObject({
      status: 'pending',
      detail: 'Starts when the task it waits on finishes',
    });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(resolveTaskProgress(harness.task(parent)).done).toBe(0);
  });

  test('a task waiting on several tasks says it starts when they all finish', () => {
    const harness = createHarness();
    const first = createTask(harness, { request: 'First' });
    const second = createTask(harness, { request: 'Second' });
    const child = createTask(harness, { request: 'Child', waitsOn: [first, second] });
    expect(resolveTaskProgress(harness.task(child)).phases[0]?.detail).toBe(
      'Starts when the tasks it waits on finish'
    );
  });

  test('fixing the open pull request stays on the pull request instead of going back to the checks', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    const progress = resolveTaskProgress(harness.task(taskId));
    expect(harness.task(taskId).stage).toBe('fixing');
    expect(statuses(harness.task(taskId))).toContain('check:done');
    expect(progress.current).toMatchObject({ key: 'pull-request', status: 'active' });
  });

  test('the steps follow the task’s own pipeline: an operation, research and a proposed change', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Rotate the logs', repoId: null, shape: 'operation' });
    const operation = Object.keys(harness.state.tasks).at(-1) ?? '';
    expect(statuses(harness.task(operation))).toEqual(['plan:pending', 'operate:pending']);
    harness.send({ type: 'task.create', request: 'Compare the libraries', repoId: null, shape: 'research' });
    const research = Object.keys(harness.state.tasks).at(-1) ?? '';
    expect(resolveTaskProgress(harness.task(research)).phases.map((phase) => phase.title)).toEqual([
      'Find the repository',
      'Research',
    ]);
    expect(statuses({ ...harness.task(research), stage: 'awaiting_proposal' })).toEqual([
      'setup:done',
      'research:done',
      'proposal:waiting',
    ]);
  });

  test('a composed change names the checks it keeps, and a fix without them shows the build as current', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = harness.task(taskId);
    const titles = (pipeline: Task['pipeline']) =>
      resolveTaskProgress({ ...task, pipeline }).phases.map((phase) => phase.title);
    expect(titles(['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'])).toContain('Checks');
    expect(titles(['plan', 'build', 'agent_review', 'your_review', 'pull_request', 'merge'])).toContain(
      'Agent review'
    );
    expect(
      statuses({
        ...task,
        stage: 'fixing',
        pipeline: ['plan', 'build', 'your_review', 'pull_request', 'merge'],
      })
    ).toEqual(['plan:done', 'build:active', 'review:pending', 'pull-request:pending', 'merge:pending']);
  });
});

describe('resolveRoundProgress', () => {
  const round: Round = {
    number: 1,
    title: 'First',
    request: 'First',
    why: null,
    shipping: 'onto_pull_request',
    status: 'shipped',
    pipeline: ['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'],
    branch: 'b',
    base: null,
    pullRequest: null,
    queuedAt: 0,
    startedAt: 0,
    endedAt: 1,
    outcome: { goal: null, phases: ['Write it'], headline: null, result: null },
  };

  test('a shipped round has its built phases done and waits on the merge', () => {
    const progress = resolveRoundProgress(round);
    expect(progress.phases.map((phase) => `${phase.title}:${phase.status}`)).toEqual([
      'Plan:done',
      'Write it:done',
      'Checks:done',
      'Your review:done',
      'Pull request:done',
      'Merge:waiting',
    ]);
    expect(progress.current?.title).toBe('Merge');
  });

  test('a cancelled round shows every step skipped', () => {
    const progress = resolveRoundProgress({ ...round, status: 'cancelled', outcome: null });
    expect(progress.phases.every((phase) => phase.status === 'skipped')).toBe(true);
    expect(progress.current).toBeNull();
  });
});
