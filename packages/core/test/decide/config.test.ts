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

  test('nothing can be skipped: a reply that names no listed repository is refused', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId, [MISSING_BRANCH, MISSING_REPOSITORY]);
    const gate = harness.openGate(taskId);
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'reply', response: 'Go.' })
    ).toThrow('Pick one of the repositories listed.');
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

  test('a repository Shinsa started says so in the activity, before the setup goes on', () => {
    const { harness, taskId } = triaged();
    harness.send({
      type: 'config.record',
      taskId,
      problems: [],
      started: { branch: 'main', initialized: false, pushed: false },
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Started the repository with an empty first commit on main'
    );
    expect(harness.task(taskId).stageReason).toBe('setting up the worktree');
  });

  test('a folder made a repository and pushed to an empty origin says both', () => {
    const { harness, taskId } = triaged();
    harness.send({
      type: 'config.record',
      taskId,
      problems: [],
      started: { branch: 'trunk', initialized: true, pushed: true },
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Made the folder a git repository and started it with an empty first commit on trunk, and pushed it to origin'
    );
  });

  test('a late start for a task that moved on records nothing', () => {
    const { harness, taskId } = triaged();
    verifySetup(harness, taskId);
    const started = { branch: 'main', initialized: false, pushed: false };
    expect(harness.send({ type: 'config.record', taskId, problems: [], started }).events).toEqual([]);
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

function triagedIn(harness: Harness, shape: TaskShape) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request: 'Fix it', repoId: null });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Fix it',
    repoId: null,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
    shape,
  });
  return { taskId };
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

  test('a task whose project only came from the focus moves to the bound repository’s project on the first round', () => {
    const harness = createHarness();
    harness.send({
      type: 'project.write',
      project: { name: 'Local', color: 'blue', key: 'LOC', folders: [] },
    });
    const local = Object.keys(harness.state.projects)[0] ?? '';
    harness.send({ type: 'focus.change', projectId: local, until: null });
    const { taskId } = triagedIn(harness, 'change');
    expect(harness.task(taskId)).toMatchObject({ projectId: local, handle: 'LOC-1' });
    const repoId = registerRepo(harness);
    const superwall = harness.state.repos[repoId]?.projectId;
    const result = bind(harness, taskId, repoId);
    expect(result.events.find((event) => event.type === 'task.repo_bound')).toMatchObject({
      projectId: superwall,
      handle: 'SUP-1',
    });
    expect(harness.task(taskId)).toMatchObject({ repoId, projectId: superwall, handle: 'SUP-1' });
    expect(harness.state.taskNumbers).toEqual({ LOC: 1, SUP: 1 });
  });

  test('a focus project is kept when the bound repository has no project, or when a later round binds one', () => {
    const harness = createHarness();
    harness.send({
      type: 'project.write',
      project: { name: 'Local', color: 'blue', key: 'LOC', folders: [] },
    });
    const local = Object.keys(harness.state.projects)[0] ?? '';
    harness.send({ type: 'focus.change', projectId: local, until: null });
    const first = triagedIn(harness, 'change');
    bind(harness, first.taskId, registerRepo(harness, 'scratch', null));
    expect(harness.task(first.taskId)).toMatchObject({ projectId: local, handle: 'LOC-1' });
    const later = triagedIn(harness, 'answer');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(later.taskId).id,
      step: 'answer',
      body: 'Hi.',
    });
    harness.send({
      type: 'task.message',
      taskId: later.taskId,
      text: 'Fix it',
      kind: 'new_round',
      shape: 'change',
    });
    const repoId = registerRepo(harness);
    bind(harness, later.taskId, repoId);
    expect(harness.task(later.taskId)).toMatchObject({ repoId, projectId: local, handle: 'LOC-2' });
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

function registerAt(harness: Harness, name: string, path: string, projectName: string | null) {
  harness.send({
    type: 'repo.register',
    repo: { name, path, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName,
  });
  return Object.values(harness.state.repos).find((repo) => repo.path === path)?.id ?? '';
}

function reply(harness: Harness, taskId: string, response: string) {
  const gate = harness.openGate(taskId);
  return harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'reply', response });
}

function triagedInProject(harness: Harness, projectId: string) {
  harness.send({ type: 'task.create', request: 'Fix the button', repoId: null, projectId });
  const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Fix the button',
    repoId: null,
    size: 'small',
    branch: 'fix/button',
    waitsOn: [],
    shape: 'change',
  });
  return taskId;
}

describe('asking which repository a task is for', () => {
  test('with no repository as the only problem, the gate lists every repository to pick from', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    registerRepo(harness, 'paywall-next');
    registerRepo(harness, 'kanna', 'Kanna');
    verifySetup(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'configuration',
      title: 'Which repository is this task for?',
      choices: ['kanna', 'paywall-next'],
    });
    expect(gate.body).toContain('Pick one below, or say in a message which repository it is.');
  });

  test('picking a repository binds it with its project and verifies the setup again', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    registerRepo(harness, 'paywall-next');
    const kanna = registerRepo(harness, 'kanna', 'Kanna');
    verifySetup(harness, taskId);
    reply(harness, taskId, 'kanna');
    expect(harness.task(taskId)).toMatchObject({
      repoId: kanna,
      projectId: harness.state.repos[kanna]?.projectId,
      stage: 'triage',
      stageReason: 'verifying the setup',
    });
    expect(harness.effectsOf('config.verify')).toHaveLength(2);
    verifySetup(harness, taskId);
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('a reply that is not one of the repositories is refused, and so is a reply to other problems', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    registerRepo(harness, 'paywall-next');
    verifySetup(harness, taskId);
    expect(() => reply(harness, taskId, 'kanna')).toThrow('Pick one of the repositories listed.');
    expect(harness.task(taskId).repoId).toBeNull();
    const other = triaged();
    verifySetup(other.harness, other.taskId, [MISSING_BRANCH]);
    expect(other.harness.openGate(other.taskId).choices).toBeUndefined();
    expect(() => reply(other.harness, other.taskId, 'paywall-next')).toThrow(
      'Pick one of the repositories listed.'
    );
  });

  test('a task in a project picks from its own repositories, or from all when its project has none', () => {
    const harness = createHarness();
    registerRepo(harness, 'paywall-next', 'Superwall');
    registerRepo(harness, 'superwall-ios', 'Superwall');
    registerRepo(harness, 'kanna', 'Kanna');
    const superwall = harness.state.repos[registerRepo(harness, 'paywall-next')]?.projectId ?? '';
    const inSuperwall = triagedInProject(harness, superwall);
    verifySetup(harness, inSuperwall);
    expect(harness.openGate(inSuperwall).choices).toEqual(['paywall-next', 'superwall-ios']);
    harness.send({ type: 'project.write', project: { name: 'Empty', color: 'blue', folders: [] } });
    const empty = Object.values(harness.state.projects).find((project) => project.name === 'Empty')?.id ?? '';
    const inEmpty = triagedInProject(harness, empty);
    verifySetup(harness, inEmpty);
    expect(harness.openGate(inEmpty).choices).toEqual(['kanna', 'paywall-next', 'superwall-ios']);
    reply(harness, inEmpty, 'kanna');
    expect(harness.task(inEmpty).projectId).toBe(empty);
  });

  test('repositories with the same name are told apart by project, then by folder', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    registerAt(harness, 'web', '/code/superwall/web', 'Superwall');
    registerAt(harness, 'web', '/code/kanna/web', 'Kanna');
    registerAt(harness, 'app', '/code/a/app', null);
    registerAt(harness, 'app', '/code/b/app', null);
    verifySetup(harness, taskId);
    expect(harness.openGate(taskId).choices).toEqual([
      'app (/code/a/app)',
      'app (/code/b/app)',
      'web (Superwall)',
      'web (Kanna)',
    ]);
    reply(harness, taskId, 'app (/code/b/app)');
    expect(harness.state.repos[harness.task(taskId).repoId ?? '']?.path).toBe('/code/b/app');
  });

  test('at most eight repositories are offered', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) registerRepo(harness, `repo-${index}`);
    verifySetup(harness, taskId);
    expect(harness.openGate(taskId).choices).toHaveLength(8);
  });

  test('another problem besides the missing repository keeps the setup text, with nothing to pick', () => {
    const { harness, taskId } = triagedWithout('change', 'Fix the button');
    registerRepo(harness, 'paywall-next');
    verifySetup(harness, taskId, [MISSING_BRANCH]);
    const gate = harness.openGate(taskId);
    expect(gate.title).toBe('The setup has 2 problems');
    expect(gate.choices).toBeUndefined();
  });
});
