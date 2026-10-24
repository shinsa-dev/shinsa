import { describe, expect, test } from 'bun:test';
import { resolveProjectContext } from '../../src/prompts/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
  registerRepo,
} from '../harness.ts';

function createBasket(harness: Harness) {
  harness.send({
    type: 'project.write',
    project: {
      name: 'Basket',
      color: 'green',
      key: 'BAS',
      description: 'The shopping app: an iOS SDK, a server and an app.',
      folders: ['/code/basket'],
    },
  });
  const server = registerRepo(harness, 'server', 'Basket');
  registerRepo(harness, 'app', 'Basket');
  harness.send({
    type: 'repo.register',
    repo: {
      name: 'ios-sdk',
      path: '/code/basket/ios-sdk',
      defaultBranch: 'main',
      remote: null,
      checkCommands: [],
    },
    projectName: null,
  });
  return { projectId: Object.keys(harness.state.projects)[0] ?? '', server };
}

describe('the project context', () => {
  test('names the project, its key, description, repositories in order with the task’s own marked, and folders', () => {
    const harness = createHarness();
    const { server } = createBasket(harness);
    const taskId = createTask(harness, { repoId: server });
    expect(resolveProjectContext(harness.state, harness.task(taskId)).split('\n')).toEqual([
      '',
      'This task belongs to the project Basket (tasks BAS-1, BAS-2 and so on). When the human says "the project", "the app" or "the server", they mean this project\'s repositories, so you do not need to ask which one.',
      'About the project: The shopping app: an iOS SDK, a server and an app.',
      'Its repositories:',
      '- app: /code/app',
      '- ios-sdk: /code/basket/ios-sdk',
      '- server: /code/server (this task works here)',
      'Its folders (every repository in them belongs to it): /code/basket',
    ]);
  });

  test('names the repository a task works in when it is outside the project', () => {
    const harness = createHarness();
    createBasket(harness);
    const projectId = Object.keys(harness.state.projects)[0] ?? '';
    const kanna = registerRepo(harness, 'kanna', null);
    const taskId = createTask(harness, { repoId: kanna });
    const lines = resolveProjectContext(harness.state, { ...harness.task(taskId), projectId }).split('\n');
    expect(lines.at(-1)).toBe('This task works in kanna (/code/kanna), a repository outside the project.');
    expect(lines).toContain('- server: /code/server');
  });

  test('leaves out a description, repositories and folders the project does not have', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Notes', color: 'blue' } });
    const projectId = Object.keys(harness.state.projects)[0] ?? '';
    harness.send({ type: 'task.create', request: 'Plan the week', repoId: null, projectId });
    const task = Object.values(harness.state.tasks)[0];
    if (!task) throw new Error('no task');
    expect(resolveProjectContext(harness.state, task).split('\n')).toEqual([
      '',
      'This task belongs to the project Notes (tasks NOT-1, NOT-2 and so on). When the human says "the project", "the app" or "the server", they mean this project\'s repositories, so you do not need to ask which one.',
    ]);
  });

  test('is empty for a task without a project, and for a project that is gone', () => {
    const harness = createHarness();
    const loose = createTask(harness, { repoId: registerRepo(harness, 'scratch', null) });
    expect(resolveProjectContext(harness.state, harness.task(loose))).toBe('');
    expect(resolveProjectContext(harness.state, { ...harness.task(loose), projectId: 'gone' })).toBe('');
  });

  test('a fresh run’s prompt carries the project context and a resumed run’s does not', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const { server } = createBasket(harness);
    const taskId = createTask(harness, { repoId: server, size: 'large' });
    const context = resolveProjectContext(harness.state, harness.task(taskId));
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(planner.prompt).toContain(context);
    expect(planner.prompt).toContain('This task belongs to the project Basket');
    linkSession(harness, taskId, 'planner-session');
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Smaller.',
    });
    const resumed = harness.activeRun(taskId);
    expect(resumed.resume).toBe(true);
    expect(resumed.prompt).not.toContain('This task belongs to the project');
  });
});
