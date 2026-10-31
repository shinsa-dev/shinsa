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

const GUIDE = [
  'Each task works in one repository and ships one pull request. When this change also needs work in another repository of the project, one listed above or any repository in its folders:',
  '- Read that repository at its path to settle what the two sides share (an endpoint, a type, an SDK call). Change files only in your own worktree: never edit, stage or commit in another checkout.',
  '- File the other part with `create_task`: `repository` set to its name (for a repository in the folders that is not listed yet, its folder name; it is registered when you name it), `fork_from` set to this task so its agent starts from this conversation, and a request that says exactly what it changes there.',
  '- Set the order. `after_this` when the other part uses what this task adds, so it starts once this task is finished. `this_task_waits` when this task needs the other part merged first; it is refused while you plan, so file that part in your first phase.',
  '- Never hand the human a step to commit, push or open a pull request in another repository: that part is a task of its own, and its order holds the merge.',
  '- Say so in your plan and hand-over, and link the task for the human.',
];

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
      ...GUIDE,
    ]);
  });

  test('names the repository a task works in when it is outside the project', () => {
    const harness = createHarness();
    createBasket(harness);
    const projectId = Object.keys(harness.state.projects)[0] ?? '';
    const kanna = registerRepo(harness, 'kanna', null);
    const taskId = createTask(harness, { repoId: kanna });
    const lines = resolveProjectContext(harness.state, { ...harness.task(taskId), projectId }).split('\n');
    expect(lines).toContain('This task works in kanna (/code/kanna), a repository outside the project.');
    expect(lines.slice(-GUIDE.length)).toEqual(GUIDE);
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

  test('teaches cross-repository work only when another repository is there to work in', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Solo', color: 'blue' } });
    const solo = registerRepo(harness, 'solo', 'Solo');
    const taskId = createTask(harness, { repoId: solo });
    const single = resolveProjectContext(harness.state, harness.task(taskId));
    expect(single).toContain('- solo: /code/solo (this task works here)');
    expect(single).not.toContain(GUIDE[0]);
    registerRepo(harness, 'sdk', 'Solo');
    expect(resolveProjectContext(harness.state, harness.task(taskId))).toContain(GUIDE.join('\n'));
    expect(resolveProjectContext(harness.state, { ...harness.task(taskId), repoId: null })).not.toContain(
      GUIDE[0]
    );
  });

  test('teaches cross-repository work when the only other repositories sit unregistered in the project folders', () => {
    const harness = createHarness();
    harness.send({
      type: 'project.write',
      project: { name: 'Superwall', color: 'blue', folders: ['/code'] },
    });
    const cli = registerRepo(harness, 'superwall', 'Superwall');
    const taskId = createTask(harness, { repoId: cli });
    expect(resolveProjectContext(harness.state, harness.task(taskId))).toContain(GUIDE.join('\n'));
  });

  test('is empty for a task without a project, and for a project that is gone', () => {
    const harness = createHarness();
    const loose = createTask(harness, { repoId: registerRepo(harness, 'scratch', null) });
    expect(resolveProjectContext(harness.state, harness.task(loose))).toBe('');
    expect(resolveProjectContext(harness.state, { ...harness.task(loose), projectId: 'gone' })).toBe('');
  });

  test('a fresh run’s prompt carries the project context and a resumed run’s does not', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
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
