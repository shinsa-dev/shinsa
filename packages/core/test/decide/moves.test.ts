import { describe, expect, test } from 'bun:test';
import {
  createHarness,
  createTask,
  type Harness,
  linkSession,
  registerRepo,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

function move(harness: Harness, taskId: string, repoId: string, reason = 'The badge lives in Studio.') {
  const runId = harness.activeRun(taskId).id;
  harness.send({ type: 'agent.move_to_repository', runId, repoId, reason });
  return runId;
}

function createMoveTask() {
  const harness = createHarness();
  const pwn = registerRepo(harness, 'pwn');
  const superwall = registerRepo(harness, 'superwall');
  const taskId = createTask(harness, { repoId: pwn, request: 'Move the badge left of the intro offer' });
  linkSession(harness, taskId);
  return { harness, pwn, superwall, taskId };
}

function refusalOf(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

describe('the agent moves its task to another repository', () => {
  test('while it plans: the old worktree goes, the task keeps its handle and branch, and planning resumes there', () => {
    const { harness, pwn, superwall, taskId } = createMoveTask();
    const handle = harness.task(taskId).handle;
    const runId = move(harness, taskId, superwall);
    expect(harness.state.runs[runId]).toMatchObject({
      outcome: 'completed',
      summary: 'The badge lives in Studio.',
    });
    expect(harness.task(taskId)).toMatchObject({
      repoId: pwn,
      movingTo: superwall,
      stage: 'triage',
      stageReason: 'moving to superwall',
    });
    expect(harness.lastEffect('worktree.remove')).toEqual({ kind: 'worktree.remove', taskId });
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId)).toMatchObject({
      repoId: superwall,
      movingTo: null,
      worktreePath: null,
      handle,
      branch: `fix/${taskId}`,
    });
    expect(harness.lastEffect('config.verify')).toEqual({ kind: 'config.verify', taskId });
    verifySetup(harness, taskId);
    expect(harness.lastEffect('worktree.create')).toEqual({ kind: 'worktree.create', taskId });
    harness.send({
      type: 'worktree.ready',
      taskId,
      path: `/wt/superwall/${taskId}`,
      branch: `fix/${taskId}`,
    });
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({ purpose: 'plan', resume: true, sessionId: 'session-1' });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'planning',
      worktreePath: `/wt/superwall/${taskId}`,
    });
    const texts = harness.task(taskId).activity.map((entry) => entry.text);
    expect(texts).toContain('Moving the task to superwall');
    expect(texts).toContain('Moved the task to superwall');
    expect(Object.keys(harness.state.tasks)).toEqual([taskId]);
  });

  test('a task whose worktree is already gone moves at once', () => {
    const { harness, superwall, taskId } = createMoveTask();
    harness.replay({ type: 'worktree.removed', taskId });
    const removals = harness.effectsOf('worktree.remove').length;
    move(harness, taskId, superwall);
    expect(harness.task(taskId)).toMatchObject({ repoId: superwall, movingTo: null });
    expect(harness.effectsOf('worktree.remove')).toHaveLength(removals);
    expect(harness.lastEffect('config.verify')).toEqual({ kind: 'config.verify', taskId });
  });

  test('a task paused while its worktree is removed moves, and waits for you to resume it', () => {
    const { harness, superwall, taskId } = createMoveTask();
    move(harness, taskId, superwall);
    harness.send({ type: 'task.pause', taskId });
    const verifies = harness.effectsOf('config.verify').length;
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId).repoId).toBe(superwall);
    expect(harness.effectsOf('config.verify')).toHaveLength(verifies);
    harness.send({ type: 'task.retry', taskId });
    expect(harness.effectsOf('config.verify')).toHaveLength(verifies + 1);
  });

  test('a task cancelled while its worktree is removed stays where it was', () => {
    const { harness, pwn, superwall, taskId } = createMoveTask();
    move(harness, taskId, superwall);
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).movingTo).toBeNull();
    const events = harness.events.length;
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId)).toMatchObject({ stage: 'cancelled', repoId: pwn });
    expect(harness.events.slice(events).map((event) => event.type)).not.toContain('task.moved');
  });

  test('a worktree removed after the move changes nothing more', () => {
    const { harness, superwall, taskId } = createMoveTask();
    move(harness, taskId, superwall);
    harness.send({ type: 'worktree.gone', taskId });
    const events = harness.events.length;
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.events).toHaveLength(events);
  });
});

describe('core refuses the move', () => {
  test('to the repository the task already works in', () => {
    const { harness, pwn, taskId } = createMoveTask();
    expect(refusalOf(() => move(harness, taskId, pwn))).toBe('This task already works in that repository.');
  });

  test('to a repository of another project, pointing at create_task', () => {
    const { harness, taskId } = createMoveTask();
    const other = registerRepo(harness, 'kanna', 'Kanna');
    expect(refusalOf(() => move(harness, taskId, other))).toBe(
      'kanna belongs to another project, so this task cannot move there. File the work there with `create_task` instead.'
    );
    expect(harness.activeRun(taskId).purpose).toBe('plan');
  });

  test('to a repository Shinsa does not know', () => {
    const { harness, taskId } = createMoveTask();
    expect(refusalOf(() => move(harness, taskId, 'nowhere'))).toBe('No repository nowhere.');
  });

  test('in a later round, once work has shipped', () => {
    const { harness, superwall, taskId } = createMoveTask();
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Now the settings page', kind: 'new_round' });
    verifySetup(harness, taskId);
    harness.send({
      type: 'worktree.ready',
      taskId,
      path: `/wt/${taskId}`,
      branch: harness.task(taskId).branch ?? '',
    });
    expect(refusalOf(() => move(harness, taskId, superwall))).toBe(
      'Work on this task has already started, so it stays where it is. File the work there with `create_task` instead.'
    );
  });

  test('for a task stacked on another, or one another task stacks on', () => {
    const { harness, pwn, superwall, taskId } = createMoveTask();
    const above = createTask(harness, { repoId: pwn, stacksOn: [taskId] });
    const message =
      'This task is part of a bundle in its repository, so it stays there. File the work there with `create_task` instead.';
    expect(refusalOf(() => move(harness, taskId, superwall))).toBe(message);
    expect(harness.task(above).stacksOn).toEqual([taskId]);
  });

  test('outside planning, where the tool is not this step’s hand-over', () => {
    const { harness, superwall, taskId } = createMoveTask();
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: {
        goal: 'Move the badge.',
        phases: [{ title: 'Move it', detail: 'Move it.' }],
        behaviour: ['It moves.'],
        approach: 'Move it.',
        files: [{ path: 'src/a.ts', change: 'Move it.' }],
        outOfScope: [],
        verification: [{ label: 'Tests', command: 'bun test test/a.test.ts', phases: [1] }],
        questions: [],
      },
    });
    expect(harness.activeRun(taskId).purpose).toBe('build');
    expect(refusalOf(() => move(harness, taskId, superwall))).not.toBeNull();
    expect(harness.task(taskId).repoId).not.toBe(superwall);
  });
});
