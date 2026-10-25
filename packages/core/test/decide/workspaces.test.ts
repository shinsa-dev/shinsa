import { describe, expect, test } from 'bun:test';
import {
  canUseGitButler,
  isSharedWorkspace,
  isWaitingForCheckout,
  listWaitsOn,
  parseUserCommand,
  resolvePullRequestBase,
  resolveRepoWorkspace,
  resolveTaskWorkspace,
  selectCheckoutHolder,
  type WorkspaceMode,
} from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  pullRequest,
  reachShipping,
  registerRepo,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

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
      ['gitbutler', 'setting up the branch'],
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

  test('a GitButler task records where it works and starts planning in the shared checkout', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    chooseWorkspace(harness, repoId, 'gitbutler');
    const first = createTask(harness, { request: 'One' });
    const second = createTask(harness, { request: 'Two' });
    for (const taskId of [first, second]) {
      expect(harness.task(taskId)).toMatchObject({ workspace: 'gitbutler', stage: 'planning' });
    }
    expect(isSharedWorkspace('gitbutler')).toBe(true);
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

  test('only the human chooses where agents work, and only from the three modes', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(() =>
      harness.send({ type: 'repo.update', repoId, patch: { workspace: 'gitbutler' } }, { onBehalf: true })
    ).toThrow('Only the human changes the repository’s workspace.');
    expect(parseUserCommand({ type: 'repo.update', repoId, patch: { workspace: 'main_checkout' } })).toEqual({
      type: 'repo.update',
      repoId,
      patch: { workspace: 'main_checkout' },
    });
    expect(() => parseUserCommand({ type: 'repo.update', repoId, patch: { workspace: 'branches' } })).toThrow(
      'workspace must be one of worktrees, gitbutler, main_checkout.'
    );
  });

  test('GitButler is offered only when it is installed and the repository is a GitButler workspace', () => {
    expect(canUseGitButler({ butInstalled: true, gitButlerWorkspace: true })).toBe(true);
    expect(canUseGitButler({ butInstalled: false, gitButlerWorkspace: true })).toBe(false);
    expect(canUseGitButler({ butInstalled: true, gitButlerWorkspace: false })).toBe(false);
  });

  test('a setup problem with where agents work opens the configuration gate with its fix', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    chooseWorkspace(harness, repoId, 'gitbutler');
    const taskId = triageTask(harness, repoId, 'Fix it');
    verifySetup(harness, taskId, [{ kind: 'workspace', detail: 'GitButler (`but`) is not installed.' }]);
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

describe('stacking on another task’s GitButler branch', () => {
  function startTwo() {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    chooseWorkspace(harness, repoId, 'gitbutler');
    const below = createTask(harness, { request: 'Rework the exporter' });
    const above = createTask(harness, { request: 'Stream the export' });
    proposePlan(harness, above);
    return { harness, repoId, below, above, branch: `fix/${below}` };
  }

  test('a task whose change needs lines another task changed stacks on its branch and waits on it', () => {
    const { harness, below, above, branch } = startTwo();
    expect(harness.task(above).stage).toBe('building');
    harness.send({ type: 'task.stack', taskId: above, branch });
    expect(harness.task(above)).toMatchObject({
      stackedOn: { taskId: below, branch },
      waitsOn: [below],
      stage: 'building',
    });
    expect(harness.events.filter((event) => event.type === 'task.stacked')).toHaveLength(1);
    expect(harness.events.at(-1)).toMatchObject({
      type: 'task.waits_on_changed',
      waitsOn: [below],
      by: 'shinsa',
    });
    const count = harness.events.length;
    harness.send({ type: 'task.stack', taskId: above, branch });
    expect(harness.events).toHaveLength(count);
  });

  test('its pull request targets the branch below while that one’s pull request is open, then the default branch', () => {
    const { harness, below, above, branch } = startTwo();
    harness.send({ type: 'task.stack', taskId: above, branch });
    expect(resolvePullRequestBase(harness.state, harness.task(above))).toBeNull();
    reachShipping(harness, below);
    harness.send({ type: 'pull_request.record', taskId: below, pullRequest: pullRequest() });
    expect(resolvePullRequestBase(harness.state, harness.task(above))).toBe(branch);
    harness.send({
      type: 'pull_request.record',
      taskId: below,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(resolvePullRequestBase(harness.state, harness.task(above))).toBeNull();
    expect(resolvePullRequestBase(harness.state, harness.task(below))).toBeNull();
  });

  test('a stacked task whose base task is gone or on another branch opens its pull request on the default branch', () => {
    const { harness, above } = startTwo();
    const task = harness.task(above);
    expect(
      resolvePullRequestBase(harness.state, { ...task, stackedOn: { taskId: 'gone', branch: 'x' } })
    ).toBeNull();
    expect(
      resolvePullRequestBase(harness.state, { ...task, stackedOn: { taskId: task.id, branch: 'other' } })
    ).toBeNull();
  });

  test('stacking is refused on a branch no open task of the repository works on, or on a task that waits on this one', () => {
    const { harness, below, above, branch } = startTwo();
    expect(() => harness.send({ type: 'task.stack', taskId: above, branch: 'feat/mine' })).toThrow(
      'No other open task of this repository works on feat/mine without waiting on this one, so this task cannot stack on it.'
    );
    expect(() => harness.send({ type: 'task.stack', taskId: above, branch: `fix/${above}` })).toThrow(
      'stack on it'
    );
    harness.send({ type: 'task.wait_on', taskId: below, waitsOn: [above] });
    expect(() => harness.send({ type: 'task.stack', taskId: above, branch })).toThrow('stack on it');
  });

  test('the dependency a stack added cannot be removed while the task below is open, by you or on your behalf', () => {
    const { harness, below, above, branch } = startTwo();
    const other = createTask(harness, { request: 'Add a footer' });
    harness.send({ type: 'task.stack', taskId: above, branch });
    harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [below, other] });
    const title = harness.task(below).title;
    const message = `This task’s branch is stacked on the branch of “${title}”, so it keeps waiting for “${title}” to merge. It stops waiting when “${title}” merges or is cancelled.`;
    expect(() => harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [other] })).toThrow(message);
    expect(() => harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [] })).toThrow(message);
    expect(() =>
      harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [] }, { onBehalf: true })
    ).toThrow(message);
    harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [below] });
    expect(harness.task(above)).toMatchObject({ waitsOn: [below], stackedOn: { taskId: below, branch } });
  });

  test('once the task below merges, the dependency is yours to remove and the stack stays for GitButler', () => {
    const { harness, below, above, branch } = startTwo();
    harness.send({ type: 'task.stack', taskId: above, branch });
    shipAndMerge(harness, below);
    expect(harness.task(above).stackedOn).toEqual({ taskId: below, branch });
    expect(harness.events.some((event) => event.type === 'task.unstacked')).toBe(false);
    harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [] });
    expect(harness.task(above).waitsOn).toEqual([]);
  });

  test('cancelling the task below unstacks the task above, drops the dependency and points its pull request at the default branch', () => {
    const { harness, below, above, branch } = startTwo();
    harness.send({ type: 'task.stack', taskId: above, branch });
    reachShipping(harness, below);
    harness.send({ type: 'pull_request.record', taskId: below, pullRequest: pullRequest() });
    expect(resolvePullRequestBase(harness.state, harness.task(above))).toBe(branch);
    const count = harness.events.length;
    harness.send({ type: 'task.cancel', taskId: below });
    const events = harness.events.slice(count).filter((event) => 'taskId' in event && event.taskId === above);
    expect(events.map((event) => event.type)).toEqual(['task.unstacked', 'task.waits_on_changed']);
    expect(events).toMatchObject([
      { type: 'task.unstacked', fromTaskId: below },
      { type: 'task.waits_on_changed', waitsOn: [], by: 'shinsa' },
    ]);
    expect(harness.task(above).stackedOn).toBeUndefined();
    expect(harness.task(above)).toMatchObject({ waitsOn: [], stage: 'building' });
    expect(resolvePullRequestBase(harness.state, harness.task(above))).toBeNull();
    harness.send({ type: 'task.wait_on', taskId: above, waitsOn: [] });
  });

  test('a settled task above is left alone when the task below is cancelled', () => {
    const { harness, below, above, branch } = startTwo();
    harness.send({ type: 'task.stack', taskId: above, branch });
    harness.send({ type: 'task.cancel', taskId: above });
    const count = harness.events.length;
    harness.send({ type: 'task.cancel', taskId: below });
    expect(harness.events.slice(count).some((event) => 'taskId' in event && event.taskId === above)).toBe(
      false
    );
    expect(harness.task(above).stackedOn).toEqual({ taskId: below, branch });
  });
});
