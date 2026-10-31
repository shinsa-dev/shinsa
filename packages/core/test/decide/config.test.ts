import { describe, expect, test } from 'bun:test';
import {
  type ConfigProblem,
  listOpenGates,
  resolveMessageEffect,
  resolveTaskProgress,
  type TaskShape,
} from '../../src/index.ts';
import { createHarness, type Harness, registerRepo, verifySetup } from '../harness.ts';

const MISSING_REPOSITORY: ConfigProblem = {
  kind: 'repository',
  detail: 'The folder /code/paywall-next does not exist.',
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

function answer(harness: Harness, taskId: string, decision: 'approve' | 'reject') {
  const gate = harness.openGate(taskId);
  harness.send({ type: 'gate.answer', gateId: gate.id, decision, response: null });
}

describe('checking the setup before any agent starts', () => {
  test('a triaged task checks the setup, then gets its worktree', () => {
    const { harness, taskId } = triaged();
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'verifying the setup' });
    expect(harness.lastEffect('config.verify').taskId).toBe(taskId);
    verifySetup(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('setting up the worktree');
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('a problem opens its own gate, with what is wrong and how to fix it', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH, MISSING_REPOSITORY]);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'configuration',
      title: 'The setup has 2 problems',
    });
    expect(gate.body).toContain('- The default branch “main” does not exist in the repository.');
    expect(gate.body).toContain(
      'Set the default branch in the repository settings, then verify the setup again.'
    );
    expect(harness.task(taskId)).toMatchObject({
      stage: 'triage',
      stageReason: 'waiting for the setup to be fixed',
      configProblems: [MISSING_BRANCH, MISSING_REPOSITORY],
    });
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ kind: 'failure', actor: 'shinsa' });
  });

  test('checking again runs the check once more, and a clean result clears the problems', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    expect(harness.openGate(taskId).title).toBe('The default branch is missing');
    answer(harness, taskId, 'approve');
    expect(harness.task(taskId).stageReason).toBe('verifying the setup');
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

  test('nothing can be skipped: the gate takes only verify again or cancel', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH, MISSING_REPOSITORY]);
    const gate = harness.openGate(taskId);
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'reply', response: 'Go.' })
    ).toThrow('Verify the setup again, or cancel.');
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
    expect(listOpenGates(harness.state, taskId)[0]?.type).toBe('configuration');
  });

  test('a message while the setup is broken verifies it again and is kept for the first agent', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('verify_setup');
    const gate = harness.openGate(taskId);
    harness.send({ type: 'task.message', taskId, text: 'Use develop.' });
    expect(harness.state.gates[gate.id]).toMatchObject({ status: 'answered', decision: 'approve' });
    expect(harness.task(taskId).stageReason).toBe('verifying the setup');
    expect(harness.effectsOf('config.verify')).toHaveLength(2);
    verifySetup(harness, taskId);
    harness.send({ type: 'worktree.ready', taskId, path: '/wt/x', branch: 'fix/scroll' });
    expect(harness.activeRun(taskId).prompt).toContain('- Use develop.');
  });

  test('a question is answered straight after a clean check, with no worktree', () => {
    const { harness, taskId } = triaged('ask');
    verifySetup(harness, taskId);
    expect(harness.task(taskId).stage).toBe('answering');
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
  });
});

function triagedWithout(shape: TaskShape, request = 'Hey') {
  const harness = createHarness();
  harness.send({ type: 'task.create', request, repoId: null });
  const taskId = Object.keys(harness.state.tasks)[0] ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: request,
    repoId: null,
    size: 'small',
    branch: 'fix/hey',
    waitsOn: [],
    shape,
  });
  return { harness, taskId };
}

function bind(harness: Harness, taskId: string, repoId: string) {
  return harness.send({ type: 'config.record', taskId, problems: [], repoId });
}

describe('a task without a repository', () => {
  test('a greeting is answered in no repository, with no worktree and no setup step', () => {
    const { harness, taskId } = triagedWithout('answer');
    expect(harness.task(taskId)).toMatchObject({ repoId: null, projectId: null, handle: 'T-1' });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain('Set up as a question');
    expect(harness.task(taskId).stage).toBe('answering');
    expect(harness.effectsOf('config.verify')).toHaveLength(0);
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
    expect(
      harness
        .task(taskId)
        .activity.map((entry) => entry.text)
        .join(' ')
    ).not.toContain('setup');
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain('The human asked a question or wrote to you.');
    expect(prompt).toContain('This task works in no repository.');
    expect(prompt).not.toContain('about this repository');
    expect(resolveTaskProgress(harness.task(taskId)).phases.map((phase) => phase.title)).toEqual(['Answer']);
  });

  test('research reads no repository either, and other kinds say what they are without one', () => {
    const research = triagedWithout('research', 'Compare queue libraries');
    expect(research.harness.task(research.taskId).stage).toBe('researching');
    expect(research.harness.activeRun(research.taskId).prompt).toContain('This task works in no repository.');
    const investigation = triagedWithout('investigate', 'Why is it slow?');
    expect(investigation.harness.task(investigation.taskId).activity.at(-1)?.text).toBe(
      'Set up as an investigation'
    );
    expect(resolveTaskProgress(investigation.harness.task(investigation.taskId)).phases[0]?.title).toBe(
      'Find the repository'
    );
  });

  test('work that needs a repository asks for one at the setup gate, and a message binds it', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    verifySetup(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'configuration', title: 'No repository for this task' });
    expect(gate.body).toContain('Say in a message which repository the task works in');
    expect(harness.task(taskId).configProblems?.map((problem) => problem.kind)).toEqual(['no_repository']);
    harness.send({ type: 'task.message', taskId, text: 'It is paywall-next.' });
    expect(harness.effectsOf('config.verify')).toHaveLength(2);
    const again = harness.send({
      type: 'config.record',
      taskId,
      problems: harness.task(taskId).configProblems ?? [],
    });
    expect(again.events.map((event) => event.type)).not.toContain('config.verified');
    harness.send({ type: 'task.message', taskId, text: 'paywall-next, really.' });
    const repoId = registerRepo(harness);
    bind(harness, taskId, repoId);
    expect(harness.task(taskId)).toMatchObject({
      repoId,
      projectId: harness.state.repos[repoId]?.projectId,
      stageReason: 'setting up the worktree',
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Chose the repository paywall-next'
    );
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('a binding never replaces a repository, and an unknown one is refused', () => {
    const { harness, taskId, repoId } = triaged();
    const other = registerRepo(harness, 'kanna');
    bind(harness, taskId, other);
    expect(harness.task(taskId).repoId).toBe(repoId);
    const without = triagedWithout('change');
    expect(() => bind(without.harness, without.taskId, 'missing')).toThrow('No repository missing');
  });

  test('a task in a project keeps its project when a repository of another one is bound', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Local', color: 'blue', folders: [] } });
    const projectId = Object.keys(harness.state.projects)[0] ?? '';
    harness.send({ type: 'task.create', request: 'Fix it', repoId: null, projectId });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Fix it',
      repoId: null,
      size: 'small',
      branch: 'fix/it',
      waitsOn: [],
    });
    bind(harness, taskId, registerRepo(harness));
    expect(harness.task(taskId).projectId).toBe(projectId);
  });

  test('a later round that asks for a change binds a repository when it starts', () => {
    const { harness, taskId } = triagedWithout('answer');
    harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'answer', body: 'Hi.' });
    harness.send({
      type: 'task.message',
      taskId,
      text: 'Fix the tab bar in paywall-next',
      kind: 'new_round',
      shape: 'change',
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'verifying the setup' });
    const repoId = registerRepo(harness);
    bind(harness, taskId, repoId);
    expect(harness.task(taskId).repoId).toBe(repoId);
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });
});
