import { describe, expect, test } from 'bun:test';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
  registerRepo,
  resolveReply,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

function move(harness: Harness, taskId: string, repoId: string, reason = 'The badge lives in Studio.') {
  const runId = harness.activeRun(taskId).id;
  harness.send({ type: 'agent.move_to_repository', runId, repoId, reason });
  return runId;
}

function moveByYou(harness: Harness, taskId: string, repoId: string) {
  harness.send({ type: 'task.move_to_repository', taskId, repoId });
}

function ask(harness: Harness, repoId: string) {
  harness.send({ type: 'task.create', request: 'How does the export retry?', repoId: null, mode: 'ask' });
  const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'How the export retries',
    repoId,
    size: 'small',
    branch: 'ask/export-retry',
    waitsOn: [],
  });
  verifySetup(harness, taskId);
  linkSession(harness, taskId, 'answer-session');
  return taskId;
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
      'Work on this task has already started, so it stays where it is. File the work there as a new task instead.'
    );
  });

  test('for a task stacked on another, or one another task stacks on', () => {
    const { harness, pwn, superwall, taskId } = createMoveTask();
    const above = createTask(harness, { repoId: pwn, stacksOn: [taskId] });
    const message =
      'This task is part of a bundle in its repository, so it stays there. File the work there as a new task instead.';
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

describe('a move across projects', () => {
  test('puts the task in the repository’s project with that project’s next handle', () => {
    const { harness, taskId } = createMoveTask();
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    const kannaProject = harness.state.repos[kanna]?.projectId;
    const before = harness.task(taskId).handle;
    move(harness, taskId, kanna);
    harness.send({ type: 'worktree.gone', taskId });
    const task = harness.task(taskId);
    expect(task).toMatchObject({ repoId: kanna, projectId: kannaProject, movingTo: null });
    expect(task.handle).not.toBe(before);
    expect(task.handle?.endsWith('-1')).toBe(true);
    expect(harness.state.taskNumbers[task.handle?.split('-')[0] ?? '']).toBe(1);
    expect(harness.lastEffect('config.verify')).toEqual({ kind: 'config.verify', taskId });
  });

  test('within the same project keeps the handle and the project', () => {
    const { harness, superwall, taskId } = createMoveTask();
    const { handle, projectId } = harness.task(taskId);
    move(harness, taskId, superwall);
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId)).toMatchObject({ handle, projectId, repoId: superwall });
  });
});

describe('an agent answering a question moves its task', () => {
  test('the answer step starts again in the new repository, in the same session', () => {
    const harness = createHarness();
    const pwn = registerRepo(harness, 'pwn');
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    const taskId = ask(harness, pwn);
    const runId = harness.activeRun(taskId).id;
    expect(harness.activeRun(taskId).role).toBe('answerer');
    harness.send({
      type: 'agent.move_to_repository',
      runId,
      repoId: kanna,
      reason: 'The retry lives in Kanna.',
    });
    expect(harness.state.runs[runId]?.outcome).toBe('completed');
    expect(harness.task(taskId)).toMatchObject({ repoId: kanna, movingTo: null, stage: 'triage' });
    verifySetup(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'answerer',
      resume: true,
      sessionId: 'answer-session',
    });
    expect(harness.activeRun(taskId).prompt).toContain('/code/kanna');
  });
});

describe('you move a task to another repository', () => {
  test('while it plans: the run stops, the worktree goes and planning starts again there', () => {
    const { harness, superwall, taskId } = createMoveTask();
    const runId = harness.activeRun(taskId).id;
    moveByYou(harness, taskId, superwall);
    expect(harness.state.runs[runId]?.outcome).toBe('cancelled');
    expect(harness.task(taskId)).toMatchObject({ movingTo: superwall, stageReason: 'moving to superwall' });
    const moving = harness
      .task(taskId)
      .activity.find((entry) => entry.text === 'Moving the task to superwall');
    expect(moving).toMatchObject({ actor: 'you', detail: null, runId: null });
    harness.send({ type: 'worktree.gone', taskId });
    verifySetup(harness, taskId);
    harness.send({
      type: 'worktree.ready',
      taskId,
      path: `/wt/superwall/${taskId}`,
      branch: `fix/${taskId}`,
    });
    expect(harness.activeRun(taskId)).toMatchObject({
      purpose: 'plan',
      resume: true,
      sessionId: 'session-1',
    });
    expect(harness.task(taskId).repoId).toBe(superwall);
  });

  test('with a plan waiting for you: the plan gate is withdrawn and planning starts again', () => {
    const harness = createHarness();
    const pwn = registerRepo(harness, 'pwn');
    const superwall = registerRepo(harness, 'superwall');
    const taskId = createTask(harness, { repoId: pwn, planFirst: true });
    linkSession(harness, taskId);
    proposePlan(harness, taskId);
    const planGate = harness.openGate(taskId);
    expect(planGate.type).toBe('plan');
    moveByYou(harness, taskId, superwall);
    expect(harness.state.gates[planGate.id]?.status).not.toBe('open');
    harness.send({ type: 'worktree.gone', taskId });
    verifySetup(harness, taskId);
    harness.send({
      type: 'worktree.ready',
      taskId,
      path: `/wt/superwall/${taskId}`,
      branch: `fix/${taskId}`,
    });
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'plan', sessionId: 'session-1' });
  });

  test('to a repository of another project, which gives it that project’s handle', () => {
    const { harness, taskId } = createMoveTask();
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    moveByYou(harness, taskId, kanna);
    harness.send({ type: 'worktree.gone', taskId });
    expect(harness.task(taskId)).toMatchObject({
      repoId: kanna,
      projectId: harness.state.repos[kanna]?.projectId,
    });
  });
});

describe('core refuses your move', () => {
  test('once the task has handed over its result', () => {
    const harness = createHarness();
    const pwn = registerRepo(harness, 'pwn');
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    const taskId = ask(harness, pwn);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.deliver',
      runId,
      step: 'answer',
      body: 'It retries three times.',
      ...resolveReply(harness, runId),
    });
    expect(refusalOf(() => moveByYou(harness, taskId, kanna))).toBe(
      'This task has already handed over its result, so it stays where it is. File the work there as a new task instead.'
    );
  });

  test('of a finished task', () => {
    const { harness, superwall, taskId } = createMoveTask();
    harness.send({ type: 'task.cancel', taskId });
    expect(refusalOf(() => moveByYou(harness, taskId, superwall))).toBe(
      'This task is finished, so it stays where it is.'
    );
  });

  test('while it is already moving', () => {
    const { harness, superwall, taskId } = createMoveTask();
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    moveByYou(harness, taskId, superwall);
    expect(refusalOf(() => moveByYou(harness, taskId, kanna))).toBe(
      'This task is already moving to another repository.'
    );
  });

  test('once a phase has reported', () => {
    const { harness, superwall, taskId } = createMoveTask();
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    expect(harness.task(taskId).phaseReports.length).toBeGreaterThan(0);
    expect(refusalOf(() => moveByYou(harness, taskId, superwall))).toBe(
      'Work on this task has already started, so it stays where it is. File the work there as a new task instead.'
    );
  });

  test('once a phase is being built, before it reports', () => {
    const { harness, superwall, taskId } = createMoveTask();
    proposePlan(harness, taskId);
    expect(harness.task(taskId).stage).toBe('building');
    expect(harness.task(taskId).phaseReports).toEqual([]);
    expect(refusalOf(() => moveByYou(harness, taskId, superwall))).toBe(
      'Work on this task has already started, so it stays where it is. File the work there as a new task instead.'
    );
    expect(refusalOf(() => move(harness, taskId, superwall))).not.toBeNull();
  });

  test('once you edited a file in its worktree', () => {
    const { harness, superwall, taskId } = createMoveTask();
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    expect(harness.task(taskId).editedPaths).toEqual(['src/a.ts']);
    expect(refusalOf(() => moveByYou(harness, taskId, superwall))).toBe(
      'Work on this task has already started, so it stays where it is. File the work there as a new task instead.'
    );
  });

  test('to the repository it already works in', () => {
    const { harness, pwn, taskId } = createMoveTask();
    expect(refusalOf(() => moveByYou(harness, taskId, pwn))).toBe(
      'This task already works in that repository.'
    );
  });
});
