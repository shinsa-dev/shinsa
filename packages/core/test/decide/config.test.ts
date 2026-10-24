import { describe, expect, test } from 'bun:test';
import { type ConfigProblem, listOpenGates } from '../../src/index.ts';
import { createHarness, type Harness, registerRepo, verifySetup } from '../harness.ts';

const MISSING_CHECKS: ConfigProblem = {
  kind: 'check_commands',
  detail: 'No check commands are set and package.json has none to run.',
};

const MISSING_BRANCH: ConfigProblem = {
  kind: 'default_branch',
  detail: 'The default branch “main” does not exist in the repository.',
};

function triaged(mode: 'build' | 'ask' = 'build') {
  const harness = createHarness();
  const repoId = registerRepo(harness);
  harness.send({ type: 'task.create', request: 'Fix the scroll', repoId, mode });
  const taskId = Object.keys(harness.state.tasks)[0] ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Fix the scroll',
    repoId,
    size: 'small',
    branch: 'fix/scroll',
    waitsOn: [],
  });
  return { harness, taskId, repoId };
}

function answer(harness: Harness, taskId: string, decision: 'approve' | 'answer' | 'reject') {
  const gate = harness.openGate(taskId);
  harness.send({ type: 'gate.answer', gateId: gate.id, decision, response: null });
}

describe('checking the setup before any agent starts', () => {
  test('a triaged task checks the setup, then gets its worktree', () => {
    const { harness, taskId } = triaged();
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'checking the setup' });
    expect(harness.lastEffect('config.verify').taskId).toBe(taskId);
    verifySetup(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('setting up the worktree');
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('a problem opens its own gate, with what is wrong and how to fix it', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH, MISSING_CHECKS]);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      kind: 'question',
      purpose: 'configuration',
      title: 'The setup has 2 problems',
    });
    expect(gate.body).toContain('- The default branch “main” does not exist in the repository.');
    expect(gate.body).toContain('Set the default branch in the repository settings, then check again.');
    expect(harness.task(taskId)).toMatchObject({
      stage: 'triage',
      stageReason: 'waiting for the setup to be fixed',
      configProblems: [MISSING_BRANCH, MISSING_CHECKS],
    });
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ kind: 'failure', actor: 'shinsa' });
  });

  test('checking again runs the check once more, and a clean result clears the problems', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    expect(harness.openGate(taskId).title).toBe('The default branch is missing');
    answer(harness, taskId, 'approve');
    expect(harness.task(taskId).stageReason).toBe('checking the setup');
    expect(harness.effectsOf('config.verify')).toHaveLength(2);
    verifySetup(harness, taskId);
    expect(harness.task(taskId).configProblems).toEqual([]);
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('the same problems again open a fresh gate and record nothing new', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    answer(harness, taskId, 'approve');
    const again = harness.send({ type: 'config.record', taskId, problems: [MISSING_BRANCH] });
    expect(again.events.map((event) => event.type)).not.toContain('config.verified');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
  });

  test('missing checks can be skipped for the repository from then on', () => {
    const { harness, taskId, repoId } = triaged();
    verifySetup(harness, taskId, [MISSING_CHECKS]);
    answer(harness, taskId, 'answer');
    expect(harness.state.repos[repoId]?.checksWaived).toBe(true);
    expect(harness.task(taskId).stageReason).toBe('checking the setup');
    verifySetup(harness, taskId, [MISSING_CHECKS]);
    answer(harness, taskId, 'answer');
    expect(harness.effectsOf('config.verify')).toHaveLength(3);
  });

  test('anything else cannot be skipped', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH, MISSING_CHECKS]);
    expect(() => answer(harness, taskId, 'answer')).toThrow('Only missing checks can be skipped.');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
  });

  test('cancelling from the gate cancels the task', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    answer(harness, taskId, 'reject');
    expect(harness.task(taskId)).toMatchObject({ stage: 'cancelled', stageReason: 'cancelled during setup' });
  });

  test('retry checks again too, and a late result for a task that moved on is ignored', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    harness.send({ type: 'task.retry', taskId });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    verifySetup(harness, taskId);
    expect(harness.send({ type: 'config.record', taskId, problems: [] }).events).toEqual([]);
    expect(harness.send({ type: 'config.record', taskId: 'gone', problems: [] }).events).toEqual([]);
  });

  test('a late worktree never starts planning past an open setup gate', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    harness.send({ type: 'worktree.ready', taskId, path: '/wt/x', branch: 'fix/scroll' });
    expect(harness.task(taskId).stage).toBe('triage');
    expect(listOpenGates(harness.state, taskId)[0]?.purpose).toBe('configuration');
  });

  test('a message while the setup is broken waits for the fix', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    harness.send({ type: 'task.message', taskId, text: 'Use develop.' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
  });

  test('a question is answered straight after a clean check, with no worktree', () => {
    const { harness, taskId } = triaged('ask');
    verifySetup(harness, taskId);
    expect(harness.task(taskId).stage).toBe('answering');
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
  });
});
