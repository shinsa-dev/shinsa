import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  isTaskPausable,
  listActiveRuns,
  listOpenGates,
  PAUSED_TITLE,
  type Run,
} from '../../src/index.ts';
import {
  approve,
  buildAll,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  pullRequest,
  readInstruction,
  proposePlan,
  reachReviewGate,
  reachShipping,
  registerRepo,
} from '../harness.ts';

const PAUSE_REFUSAL = 'Nothing is working on this task to pause.';

function pause(harness: Harness, taskId: string) {
  return harness.send({ type: 'task.pause', taskId });
}

function pausedGate(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).find((gate) => gate.cause === 'paused');
}

function delegateFrom(harness: Harness, parentId: string) {
  const command: CommandOf<'agent.delegate'> = {
    type: 'agent.delegate',
    runId: parentId,
    requestKey: 'pause-child',
    title: 'Check the copy',
    brief: 'Read the strings in src/copy.ts and report any that break the copy rules.',
    role: 'reviewer',
    mode: 'async',
    isolation: 'shared',
    baseCommit: null,
    provider: null,
    model: null,
  };
  const before = new Set(Object.keys(harness.state.runs));
  harness.send(command);
  const id = Object.keys(harness.state.runs).find((runId) => !before.has(runId)) ?? '';
  return harness.state.runs[id] as Run;
}

describe('pausing a task', () => {
  test('stops the running agent and its delegated agents and opens the paused gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const parent = harness.activeRun(taskId);
    harness.send({ type: 'run.link', runId: parent.id, sessionId: 'session-1', provider: 'claude' });
    const child = delegateFrom(harness, parent.id);
    harness.send({ type: 'run.link', runId: child.id, sessionId: 'child-session', provider: 'claude' });

    pause(harness, taskId);

    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
    expect(harness.state.runs[parent.id]?.outcome).toBe('cancelled');
    expect(harness.state.runs[child.id]?.outcome).toBe('cancelled');
    const cancelled = harness.effectsOf('run.cancel').map((effect) => effect.runId);
    expect(cancelled).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(pausedGate(harness, taskId)).toMatchObject({ type: 'failure', title: PAUSED_TITLE });
    expect(harness.task(taskId).stage).toBe('building');
    expect(isTaskPausable(harness.state, harness.task(taskId))).toBe(false);
  });

  test('cancels the effects in flight, so a late result cannot undo the pause', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');

    const decision = pause(harness, taskId);

    expect(decision.cancellations).toEqual([
      {
        taskId,
        kinds: [
          'task.triage',
          'config.verify',
          'worktree.create',
          'checks.run',
          'pull_request.open',
          'pull_request.push',
        ],
        reason: 'You paused the task.',
      },
    ]);
    expect(pausedGate(harness, taskId)).toBeDefined();
  });

  test('pauses a task still in triage', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Fix the footer', repoId: registerRepo(harness) });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    expect(harness.task(taskId).stage).toBe('triage');

    pause(harness, taskId);

    expect(pausedGate(harness, taskId)).toBeDefined();
  });

  test('Resume restarts the step in the same agent session', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'session-1');
    pause(harness, taskId);

    harness.send({ type: 'task.retry', taskId });

    expect(pausedGate(harness, taskId)).toBeUndefined();
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', resume: true, sessionId: 'session-1' });
  });

  test('a message resumes the step with the message as guidance', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'session-1');
    pause(harness, taskId);

    harness.send({ type: 'task.message', taskId, text: 'Keep the old scroll behaviour on mobile.' });

    expect(pausedGate(harness, taskId)).toBeUndefined();
    const run = harness.activeRun(taskId);
    expect(run.sessionId).toBe('session-1');
    expect(readInstruction(run)).toContain('Keep the old scroll behaviour on mobile.');
  });
});

describe('refusing to pause', () => {
  test('a task already paused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    pause(harness, taskId);
    expect(() => pause(harness, taskId)).toThrow(PAUSE_REFUSAL);
  });

  test('a task shipping its pull request can be paused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    expect(harness.task(taskId).stage).toBe('shipping');
    pause(harness, taskId);
    expect(pausedGate(harness, taskId)).toBeDefined();
  });

  test('a task waiting on you at a gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    expect(() => pause(harness, taskId)).toThrow(PAUSE_REFUSAL);
  });

  test('a task waiting on another task', () => {
    const harness = createHarness();
    const first = createTask(harness);
    const second = createTask(harness, { waitsOn: [first] });
    expect(harness.task(second).stage).toBe('waiting_on_tasks');
    expect(() => pause(harness, second)).toThrow(PAUSE_REFUSAL);
  });

  test('a settled task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => pause(harness, taskId)).toThrow(PAUSE_REFUSAL);
  });

  test('a task whose pull request waits for the merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId).stage).toBe('awaiting_merge');
    expect(() => pause(harness, taskId)).toThrow(PAUSE_REFUSAL);
  });
});
