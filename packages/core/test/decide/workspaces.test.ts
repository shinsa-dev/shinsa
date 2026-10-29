import { describe, expect, test } from 'bun:test';
import {
  isSharedWorkspace,
  isWaitingForCheckout,
  listWaitsOn,
  parseUserCommand,
  resolveRepoWorkspace,
  resolveTaskWorkspace,
  selectCheckoutHolder,
  type WorkspaceMode,
} from '../../src/index.ts';
import { createHarness, createTask, type Harness, registerRepo, verifySetup } from '../harness.ts';

function chooseWorkspace(harness: Harness, repoId: string, workspace: WorkspaceMode) {
  harness.send({ type: 'repo.update', repoId, patch: { workspace } });
}

function readyCheckout(harness: Harness, taskId: string) {
  harness.send({ type: 'worktree.ready', taskId, path: '/code/paywall-next', branch: `fix/${taskId}` });
}

function startInCheckout(harness: Harness) {
  const repoId = registerRepo(harness);
  chooseWorkspace(harness, repoId, 'main_checkout');
  const first = createTask(harness, { request: 'Fix the scroll' });
  return { repoId, first };
}

function triageTask(harness: Harness, repoId: string, title: string) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request: title, repoId });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title,
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
  });
  return taskId;
}

function createWaitingTask(harness: Harness, request: string) {
  const taskId = createTask(harness, { request });
  verifySetup(harness, taskId);
  return taskId;
}

describe('where agents work', () => {
  test('a repository works in worktrees until you choose otherwise', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(resolveRepoWorkspace(harness.state.repos[repoId])).toBe('worktrees');
    expect(resolveRepoWorkspace(null)).toBe('worktrees');
    const taskId = createTask(harness);
    expect(harness.task(taskId)).toMatchObject({ workspace: 'worktrees', worktreePath: `/wt/${taskId}` });
    expect(harness.events.find((event) => event.type === 'worktree.requested')).toMatchObject({
      workspace: 'worktrees',
    });
  });

  test('the setup step says what it sets up for each mode', () => {
    for (const [workspace, reason] of [
      ['worktrees', 'setting up the worktree'],
      ['main_checkout', 'setting up the checkout'],
    ] as const) {
      const harness = createHarness();
      const repoId = registerRepo(harness);
      chooseWorkspace(harness, repoId, workspace);
      const taskId = triageTask(harness, repoId, 'Fix it');
      verifySetup(harness, taskId);
      expect(harness.task(taskId)).toMatchObject({ stageReason: reason, workspace });
      expect(harness.lastEffect('worktree.create')).toEqual({ kind: 'worktree.create', taskId });
    }
  });

  test('only the main checkout is shared between tasks', () => {
    expect(isSharedWorkspace('main_checkout')).toBe(true);
    expect(isSharedWorkspace('worktrees')).toBe(false);
  });

  test('in the main checkout a second task waits for the first, and starts once its checkout is given back', () => {
    const harness = createHarness();
    const { first } = startInCheckout(harness);
    readyCheckout(harness, first);
    const second = createWaitingTask(harness, 'Add the banner');
    expect(harness.task(second)).toMatchObject({
      stage: 'waiting_on_tasks',
      stageReason: 'waiting for “Fix the scroll” to finish with the checkout',
    });
    expect(selectCheckoutHolder(harness.state, harness.task(second))?.id).toBe(first);
    expect(isWaitingForCheckout(harness.state, harness.task(second))).toBe(true);
    expect(listWaitsOn(harness.state, harness.task(second)).map((task) => task.id)).toEqual([first]);

    harness.send({ type: 'task.cancel', taskId: first });
    expect(harness.task(second).stage).toBe('waiting_on_tasks');
    harness.send({ type: 'worktree.gone', taskId: first });
    expect(harness.task(second)).toMatchObject({ stage: 'triage', stageReason: 'verifying the setup' });
    verifySetup(harness, second);
    expect(harness.task(second)).toMatchObject({ stageReason: 'setting up the checkout' });
  });

  test('a task setting up the checkout already holds it', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    chooseWorkspace(harness, repoId, 'main_checkout');
    const first = triageTask(harness, repoId, 'One');
    verifySetup(harness, first);
    expect(harness.task(first).stageReason).toBe('setting up the checkout');
    const second = createWaitingTask(harness, 'Two');
    expect(harness.task(second).stage).toBe('waiting_on_tasks');
    readyCheckout(harness, second);
    expect(harness.task(second).worktreePath).toBeNull();
  });

  test('a task waiting for the checkout is checked again before its setup is verified', () => {
    const harness = createHarness();
    const { first } = startInCheckout(harness);
    readyCheckout(harness, first);
    const second = createTask(harness, { request: 'Two' });
    expect(harness.task(second).stage).toBe('waiting_on_tasks');
    expect(harness.effectsOf('config.verify').filter((effect) => effect.taskId === second)).toHaveLength(0);
  });

  test('switching the repository to worktrees lets a waiting task start without the checkout', () => {
    const harness = createHarness();
    const { repoId, first } = startInCheckout(harness);
    readyCheckout(harness, first);
    const second = createWaitingTask(harness, 'Two');
    chooseWorkspace(harness, repoId, 'worktrees');
    expect(harness.task(second).stageReason).toBe('verifying the setup');
    verifySetup(harness, second);
    expect(harness.task(second)).toMatchObject({ workspace: 'worktrees' });
    expect(harness.task(first)).toMatchObject({ workspace: 'main_checkout' });
    expect(resolveTaskWorkspace(harness.state, harness.task(first))).toBe('main_checkout');
  });

  test('a task without a repository never waits for a checkout', () => {
    const harness = createHarness();
    const { first } = startInCheckout(harness);
    readyCheckout(harness, first);
    const unbound = { ...harness.task(first), id: 'other', repoId: null, worktreePath: null };
    expect(selectCheckoutHolder(harness.state, unbound)).toBeNull();
    expect(resolveTaskWorkspace(harness.state, unbound)).toBe('worktrees');
  });

  test('only the human chooses where agents work, and only from the two modes', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(() =>
      harness.send({ type: 'repo.update', repoId, patch: { workspace: 'main_checkout' } }, { onBehalf: true })
    ).toThrow('Only the human changes the repository’s workspace.');
    expect(parseUserCommand({ type: 'repo.update', repoId, patch: { workspace: 'main_checkout' } })).toEqual({
      type: 'repo.update',
      repoId,
      patch: { workspace: 'main_checkout' },
    });
    for (const workspace of ['branches', 'gitbutler']) {
      expect(() => parseUserCommand({ type: 'repo.update', repoId, patch: { workspace } })).toThrow(
        'workspace must be one of worktrees, main_checkout.'
      );
    }
  });

  test('a setup problem with where agents work opens the configuration gate with its fix', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    chooseWorkspace(harness, repoId, 'main_checkout');
    const taskId = triageTask(harness, repoId, 'Fix it');
    verifySetup(harness, taskId, [{ kind: 'workspace', detail: 'The checkout has uncommitted changes.' }]);
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'configuration',
      title: 'Agents cannot work in this repository yet',
    });
    expect(harness.openGate(taskId).body).toContain('change where agents work in Settings → Projects');
  });

  test('a task in the main checkout remembers the branch the checkout was on, through a repeated ready', () => {
    const harness = createHarness();
    const { first } = startInCheckout(harness);
    const ready = {
      type: 'worktree.ready',
      taskId: first,
      path: '/code/paywall-next',
      branch: `fix/${first}`,
    } as const;
    harness.send({ ...ready, returnBranch: 'feat/mine' });
    expect(harness.task(first)).toMatchObject({
      returnBranch: 'feat/mine',
      worktreePath: '/code/paywall-next',
    });
    const created = () => harness.events.filter((event) => event.type === 'worktree.created').length;
    const before = created();
    harness.send(ready);
    harness.send({ ...ready, returnBranch: 'feat/mine' });
    expect(created()).toBe(before);
    expect(harness.task(first).returnBranch).toBe('feat/mine');
    harness.send({ ...ready, returnBranch: 'feat/other' });
    expect(created()).toBe(before + 1);
    expect(harness.task(first).returnBranch).toBe('feat/other');
  });
});
