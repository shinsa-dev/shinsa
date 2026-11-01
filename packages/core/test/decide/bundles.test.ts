import { describe, expect, test } from 'bun:test';
import {
  listBundleAbove,
  listBundleBelow,
  listOpenGates,
  listWaitsOn,
  type PullRequest,
  resolveBundle,
  resolveRoundBase,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  pullRequest,
  pushed,
  pushFix,
  reachShipping,
  readyWorktree,
  registerRepo,
  verifySetup,
} from '../harness.ts';

function recordClean(harness: Harness, taskId: string, number = 42, overrides: Partial<PullRequest> = {}) {
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, checks: 'none', ...overrides }),
    ci: 'none',
  });
}

function reachReady(harness: Harness, taskId: string, number = 42) {
  if (harness.task(taskId).stage !== 'shipping') reachShipping(harness, taskId);
  recordClean(harness, taskId, number);
  const task = harness.task(taskId);
  expect(task.bundleReady ? task.stageReason : harness.openGate(taskId).type).toMatch(/merge/);
}

function recordMerged(harness: Harness, taskId: string, number: number) {
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, state: 'merged' }),
  });
}

function createBundle(harness: Harness) {
  const root = createTask(harness, { request: 'Root' });
  const middle = createTask(harness, { request: 'Middle', stacksOn: root });
  const top = createTask(harness, { request: 'Top', stacksOn: middle });
  reachReady(harness, root, 1);
  readyWorktree(harness, middle);
  reachReady(harness, middle, 2);
  readyWorktree(harness, top);
  reachReady(harness, top, 3);
  recordClean(harness, root, 1);
  return { root, middle, top };
}

function recordCheck(
  harness: Harness,
  taskId: string,
  conflict: { taskId: string; behindTaskId: string | null } | null
) {
  harness.send({
    type: 'bundle.record_check',
    taskId,
    conflict: conflict ? { ...conflict, base: 'main' } : null,
  });
}

const READY = 'ready, merges with its bundle';

function stackOn(harness: Harness, taskId: string, stacksOn: string | null) {
  harness.send({ type: 'task.stack_on', taskId, stacksOn });
}

describe('stacking a task on another', () => {
  test('a stacked task waits until the task below is ready to merge, then branches off it', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Run the chat on MCP v2' });
    const child = createTask(harness, { request: 'Embed the chat', stacksOn: parent });
    expect(harness.task(child).stacksOn).toBe(parent);
    expect(harness.task(child).auto.start).toBe(false);
    expect(harness.task(child).stage).toBe('waiting_on_tasks');
    expect(harness.task(child).stageReason).toBe('waiting for “Run the chat on MCP v2” to be ready to merge');
    expect(harness.task(child).activity.map((entry) => entry.text)).toContain(
      'Stacked on “Run the chat on MCP v2” as a bundle'
    );
    expect(listWaitsOn(harness.state, harness.task(child)).map((task) => task.id)).toEqual([parent]);

    reachShipping(harness, parent);
    expect(harness.task(child).stage).toBe('waiting_on_tasks');

    reachReady(harness, parent);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBase).toBe(`fix/${parent}`);
    expect(resolveRoundBase(harness.task(child))).toBe(`fix/${parent}`);
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
  });

  test('a task stacked on one that is already ready starts at once on its branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    reachReady(harness, parent);
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    expect(harness.task(child).stage).toBe('planning');
    expect(harness.task(child).stackBase).toBe(`fix/${parent}`);
  });

  test('a task below that finishes without a pull request releases the stacked one onto the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    harness.send({ type: 'task.complete', taskId: parent });
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBase ?? null).toBeNull();
    expect(resolveRoundBase(harness.task(child))).toBeNull();
  });

  test('waiting on other tasks and stacking combine in the reason', () => {
    const harness = createHarness();
    const api = createTask(harness, { request: 'Ship the API' });
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', waitsOn: [api, parent], stacksOn: parent });
    expect(harness.task(child).waitsOn).toEqual([api]);
    expect(harness.task(child).stageReason).toBe(
      'waiting for “Ship the API” to finish and “Parent” to be ready to merge'
    );
    harness.send({ type: 'task.wait_on', taskId: child, waitsOn: [api, parent] });
    expect(harness.task(child).waitsOn).toEqual([api]);
  });

  test('stacking a waiting task moves its wait on that task into the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
    stackOn(harness, child, parent);
    expect(harness.task(child).waitsOn).toEqual([]);
    expect(harness.task(child).stacksOn).toBe(parent);
    expect(harness.task(child).stage).toBe('waiting_on_tasks');
    stackOn(harness, child, parent);
    expect(harness.events.filter((event) => event.type === 'task.stack_changed')).toHaveLength(1);
  });

  test('stacking a planning task sends it back to wait, and leaving the bundle starts it again', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child' });
    const planning = harness.activeRun(child).id;
    stackOn(harness, child, parent);
    expect(harness.state.runs[planning]?.outcome).toBe('cancelled');
    expect(harness.task(child).stage).toBe('waiting_on_tasks');

    stackOn(harness, child, null);
    expect(harness.task(child).stacksOn).toBeNull();
    expect(harness.task(child).activity.map((entry) => entry.text)).toContain('Left its bundle');
    expect(harness.task(child).stage).toBe('triage');
  });

  test('stacking a task at its plan gate on a ready one sets it up again on that branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    reachReady(harness, parent);
    const child = createTask(harness, { request: 'Child', planFirst: true });
    proposePlan(harness, child);
    expect(harness.openGate(child).type).toBe('plan');
    stackOn(harness, child, parent);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBase).toBe(`fix/${parent}`);
    expect(harness.lastEffect('config.verify').taskId).toBe(child);
  });

  test('a task still in triage keeps its triage, and a set-up task goes to wait', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const parent = createTask(harness, { request: 'Parent', repoId });
    const ready = createTask(harness, { request: 'Ready', repoId });
    reachReady(harness, ready);
    harness.send({ type: 'task.create', request: 'Unsorted', repoId });
    const unsorted = Object.values(harness.state.tasks).find((task) => task.request === 'Unsorted')?.id ?? '';
    stackOn(harness, unsorted, parent);
    expect(harness.task(unsorted).stage).toBe('triage');
    expect(harness.task(unsorted).stackBase ?? null).toBeNull();
    stackOn(harness, unsorted, ready);
    expect(harness.task(unsorted).stackBase).toBe(`fix/${ready}`);

    harness.send({
      type: 'task.triage',
      taskId: unsorted,
      title: 'Unsorted',
      repoId,
      size: 'small',
      branch: `fix/${unsorted}`,
      waitsOn: [ready],
    });
    expect(harness.task(unsorted).waitsOn).toEqual([]);
    expect(harness.task(unsorted).stage).toBe('triage');
    stackOn(harness, unsorted, parent);
    expect(harness.task(unsorted).stage).toBe('waiting_on_tasks');
  });

  test('a cancelled task below pauses the stacked one, and Retry takes it out of the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(harness.openGate(child).type).toBe('failure');
    harness.send({ type: 'task.retry', taskId: child });
    expect(harness.task(child).stacksOn).toBeNull();
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBase ?? null).toBeNull();
  });

  test('a task paused by a cancelled task below can stack on another one instead', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const other = createTask(harness, { request: 'Other' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(harness.openGate(child).type).toBe('failure');
    stackOn(harness, child, other);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(harness.task(child).stageReason).toBe('waiting for “Other” to be ready to merge');
  });

  test('a bundle is one line in one repository, without cycles, and only before building', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    const other = createTask(harness, { request: 'Other' });
    const refusals: [() => unknown, string][] = [
      [() => stackOn(harness, other, other), 'A task cannot stack on itself.'],
      [() => stackOn(harness, other, parent), '“Child” is already stacked on that task.'],
      [() => stackOn(harness, parent, child), 'That task already waits on this one.'],
    ];
    const cancelled = createTask(harness, { request: 'Cancelled' });
    harness.send({ type: 'task.cancel', taskId: cancelled });
    refusals.push([() => stackOn(harness, other, cancelled), 'That task was cancelled.']);
    const done = createTask(harness, { request: 'Done' });
    harness.send({ type: 'task.complete', taskId: done });
    refusals.push([
      () => stackOn(harness, other, done),
      'That task is finished, so there is nothing to stack on.',
    ]);
    refusals.push([() => stackOn(harness, done, parent), 'This task is finished.']);
    harness.send({ type: 'task.create', request: 'Why is it slow?', repoId: null, mode: 'ask' });
    const question = Object.values(harness.state.tasks).find((task) => task.mode === 'ask')?.id ?? '';
    refusals.push([() => stackOn(harness, other, question), 'That task opens no pull request to stack on.']);
    const elsewhere = createTask(harness, { request: 'Elsewhere', repoId: registerRepo(harness, 'other') });
    refusals.push([
      () => stackOn(harness, elsewhere, other),
      'The tasks of a bundle work in one repository.',
    ]);
    const shipping = createTask(harness, { request: 'Shipping' });
    reachShipping(harness, shipping);
    refusals.push([
      () => stackOn(harness, shipping, other),
      'This task has started building, so its bundle can no longer change.',
    ]);
    for (const [refused, message] of refusals) expect(refused).toThrow(message);
    expect(() => stackOn(harness, child, parent)).not.toThrow();
  });
});

describe('a bundle on its way to the merge', () => {
  test('the root holds its merge gate until the task stacked on it is ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent);
    expect(listOpenGates(harness.state, parent)).toHaveLength(0);
    expect(harness.task(parent).stage).toBe('shipping');
    expect(harness.task(parent).stageReason).toBe('waiting for “Child” to be ready to merge');
    expect(harness.task(parent).bundleReady).toEqual({ commit: null });
    expect(harness.task(child).stage).toBe('triage');
    recordClean(harness, parent);
    recordClean(harness, parent, 42, { checks: 'pending' });
    expect(harness.task(parent).stageReason).toBe('waiting for “Child” to be ready to merge');
    expect(harness.events.filter((event) => event.type === 'task.bundle_ready')).toHaveLength(1);
  });

  test('a ready task starts another round at once and stops being ready until that round ships', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent);
    harness.send({
      type: 'task.message',
      taskId: parent,
      text: 'Also log the calls',
      kind: 'new_round',
      title: 'Log the calls',
    });
    expect(harness.task(parent).stage).toBe('triage');
    expect(harness.task(parent).bundleReady).toBeNull();
  });

  test('a task at its merge gate gives the gate up when a task stacks on it', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    reachReady(harness, parent);
    expect(harness.openGate(parent).type).toBe('merge');
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    expect(listOpenGates(harness.state, parent)).toHaveLength(0);
    expect(harness.task(parent).stageReason).toBe('waiting for “Child” to be ready to merge');
    expect(harness.task(child).stage).toBe('planning');
  });

  test('the root into the default branch holds one merge gate for the whole bundle while every task above stays ready', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    const gate = harness.openGate(root);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain(
      'Approving merges the whole bundle as one, from the last pull request back to this one: #1 “Root”, #2 “Middle”, #3 “Top”.'
    );
    expect(listOpenGates(harness.state, top)).toHaveLength(0);
    expect(harness.task(top).stageReason).toBe(READY);
    expect(listBundleAbove(harness.state, harness.task(root)).map((task) => task.id)).toEqual([middle, top]);
    expect(listBundleBelow(harness.state, harness.task(top)).map((task) => task.id)).toEqual([middle, root]);

    recordClean(harness, top, 3, { checks: 'failing' });
    expect(harness.task(top).bundleReady).toBeNull();
    expect(harness.task(top).stage).toBe('fixing');
    expect(listOpenGates(harness.state, root)).toHaveLength(0);
    expect(harness.task(root).stageReason).toBe('waiting for “Top” to be ready to merge');

    const watches = harness.effectsOf('pull_request.watch').length;
    pushFix(harness, top);
    recordClean(harness, top, 3);
    expect(harness.task(top).stageReason).toBe(READY);
    expect(
      harness
        .effectsOf('pull_request.watch')
        .slice(watches)
        .map((effect) => effect.taskId)
    ).toContain(root);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');
  });

  test('a task above that turns clean before the root waits for it, ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    reachShipping(harness, child);
    recordClean(harness, parent, 1, { mergeable: false });
    recordClean(harness, child, 2);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(listOpenGates(harness.state, parent)).toHaveLength(0);
    expect(harness.task(child).stageReason).toBe(READY);
    pushFix(harness, parent);
    recordClean(harness, parent, 1);
    expect(harness.openGate(parent).type).toBe('merge');
  });

  test('approving the bundle on the root merges every pull request from the last one back, and each task ends merged', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    expect(harness.lastEffect('pull_request.merge')).toEqual({
      kind: 'pull_request.merge',
      taskId: root,
      headSha: null,
      bundle: [
        { taskId: top, number: 3 },
        { taskId: middle, number: 2 },
      ],
    });
    for (const above of [middle, top]) {
      expect(harness.task(above).stage).toBe('awaiting_merge');
      expect(harness.task(above).stageReason).toBe('merging with its bundle');
    }
    recordMerged(harness, top, 3);
    recordClean(harness, middle, 2);
    expect(listOpenGates(harness.state, middle)).toHaveLength(0);
    expect(harness.task(middle).stage).toBe('awaiting_merge');
    recordMerged(harness, middle, 2);
    recordMerged(harness, root, 1);
    expect([root, middle, top].map((id) => harness.task(id).stage)).toEqual(['merged', 'merged', 'merged']);
    expect(resolveBundle(harness.state, harness.task(root)).map((task) => task.id)).toEqual([
      root,
      middle,
      top,
    ]);
  });

  test('a failed bundle merge puts the tasks above back to ready, and Retry opens the root’s gate again', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    harness.send({ type: 'effect.fail', taskId: root, title: 'Could not merge', detail: 'GitHub refused.' });
    expect(harness.openGate(root).type).toBe('failure');
    for (const above of [middle, top]) expect(harness.task(above).stageReason).toBe(READY);
    approve(harness, root);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');
  });

  test('a bundle merge that stops partway leaves the rest to merge from the root', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    recordMerged(harness, top, 3);
    harness.send({ type: 'effect.fail', taskId: root, title: 'Could not merge', detail: 'GitHub refused.' });
    expect(harness.task(middle).stageReason).toBe(READY);
    approve(harness, root);
    recordClean(harness, root, 1);
    const gate = harness.openGate(root);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain('#1 “Root”, #2 “Middle”.');
  });

  test('a task below that merges outside Shinsa moves the one above onto the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    reachShipping(harness, child);
    expect(resolveRoundBase(harness.task(child))).toBe(`fix/${parent}`);
    recordClean(harness, child, 2, { checks: 'pending' });
    const watches = harness.effectsOf('pull_request.watch').length;
    recordMerged(harness, parent, 1);
    expect(harness.task(child).stackBase).toBeNull();
    expect(resolveRoundBase(harness.task(child))).toBeNull();
    expect(
      harness
        .effectsOf('pull_request.watch')
        .slice(watches)
        .map((effect) => effect.taskId)
    ).toContain(child);
    recordClean(harness, child, 2);
    expect(harness.openGate(child).type).toBe('merge');
  });

  test('a root that merges outside Shinsa hands the merge gate to the task above it', () => {
    const harness = createHarness();
    const { root, middle } = createBundle(harness);
    recordMerged(harness, root, 1);
    expect(harness.task(middle).stackBase).toBeNull();
    recordClean(harness, middle, 2);
    const gate = harness.openGate(middle);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain('#2 “Middle”, #3 “Top”.');
  });

  test('a cancelled task below pauses the started one above, and Retry takes it out of the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
    harness.send({ type: 'task.cancel', taskId: parent });
    const gate = harness.openGate(child);
    expect(gate.title).toBe('“Parent” was cancelled');
    expect(harness.task(child).stackBase).toBe(`fix/${parent}`);
    approve(harness, child);
    expect(harness.task(child).stacksOn).toBeNull();
    expect(harness.task(child).stackBase).toBeNull();
    expect(harness.task(child).stage).toBe('planning');
  });

  test('taking a planning task out of its bundle replans it from the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    expect(harness.task(child).stackBase).toBe(`fix/${parent}`);
    const creates = harness.effectsOf('worktree.create').length;
    stackOn(harness, child, null);
    expect(harness.task(child).stacksOn).toBeNull();
    expect(harness.task(child).stackBase).toBeNull();
    expect(resolveRoundBase(harness.task(child))).toBeNull();
    verifySetup(harness, child);
    expect(harness.effectsOf('worktree.create').length).toBe(creates + 1);
    expect(harness.task(parent).bundleReady).toBeNull();
  });

  test('the root gets its own merge gate once nothing is stacked on it any more', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: parent });
    reachReady(harness, parent, 1);
    harness.send({ type: 'task.stack_on', taskId: child, stacksOn: null });
    expect(harness.task(parent).bundleReady).toBeNull();
    expect(harness.task(parent).stageReason).toBe('checking the pull request');
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(parent);
    recordClean(harness, parent, 1);
    expect(harness.openGate(parent).type).toBe('merge');

    const other = createTask(harness, { request: 'Other', stacksOn: parent });
    expect(listOpenGates(harness.state, parent)).toHaveLength(0);
    harness.send({ type: 'task.cancel', taskId: other });
    recordClean(harness, parent, 1);
    expect(harness.openGate(parent).type).toBe('merge');
  });

  test('a ready task that waits on another task to merge stops being ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    createTask(harness, { request: 'Child', stacksOn: parent });
    const api = createTask(harness, { request: 'Ship the API' });
    reachReady(harness, parent, 1);
    harness.send({ type: 'task.wait_on', taskId: parent, waitsOn: [api] });
    expect(harness.task(parent).bundleReady).toBeNull();
    expect(harness.task(parent).stageReason).toBe('waiting for “Ship the API” to merge');
  });

  test('a question stacked on a task does not hold its merge', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    harness.send({
      type: 'task.create',
      request: 'Why is it slow?',
      repoId: null,
      mode: 'ask',
      stacksOn: parent,
    });
    reachReady(harness, parent);
    expect(harness.openGate(parent).type).toBe('merge');
  });

  test('a loose task is in no bundle', () => {
    const harness = createHarness();
    const loose = createTask(harness, { request: 'Loose' });
    expect(resolveBundle(harness.state, harness.task(loose))).toEqual([]);
    expect(listBundleBelow(harness.state, harness.task(loose))).toEqual([]);
    expect(listBundleAbove(harness.state, harness.task(loose))).toEqual([]);
  });
});

describe('a bundle that conflicts with the default branch', () => {
  test('the root holds its gate and brings the lowest branch behind up to date first', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    recordCheck(harness, root, { taskId: top, behindTaskId: middle });
    expect(listOpenGates(harness.state, root)).toHaveLength(0);
    expect(harness.task(root).stageReason).toBe(
      '“Top” conflicts with main once the bundle merges; updating “Middle” first'
    );
    expect(harness.task(middle).stageReason).toBe('updating the branch onto main');
    expect(harness.task(middle).bundleReady).toBeNull();
    expect(harness.lastEffect('pull_request.push').taskId).toBe(middle);

    recordCheck(harness, root, { taskId: top, behindTaskId: middle });
    expect(harness.effectsOf('pull_request.push').filter((effect) => effect.taskId === middle)).toHaveLength(
      1
    );

    pushed(harness, middle);
    recordClean(harness, middle, 2);
    expect(harness.task(middle).stageReason).toBe(READY);
    recordClean(harness, root, 1);
    expect(listOpenGates(harness.state, root)).toHaveLength(0);

    recordCheck(harness, root, null);
    expect(harness.task(root).bundleConflict).toBeNull();
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(root);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');
    recordCheck(harness, root, null);
    expect(harness.openGate(root).type).toBe('merge');
  });

  test('a conflict with no branch behind pauses the root', () => {
    const harness = createHarness();
    const { root, top } = createBundle(harness);
    recordCheck(harness, root, { taskId: top, behindTaskId: null });
    const gate = harness.openGate(root);
    expect(gate.type).toBe('failure');
    expect(gate.title).toBe('The bundle conflicts with main');
    recordCheck(harness, root, { taskId: top, behindTaskId: null });
    expect(listOpenGates(harness.state, root)).toHaveLength(1);
  });

  test('a branch behind that is still busy is updated later, and a check while merging changes nothing', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    recordClean(harness, middle, 2, { checks: 'failing' });
    expect(harness.task(middle).stage).toBe('fixing');
    recordCheck(harness, root, { taskId: top, behindTaskId: middle });
    expect(harness.effectsOf('pull_request.push').filter((effect) => effect.taskId === middle)).toHaveLength(
      0
    );

    const fresh = createHarness();
    const bundle = createBundle(fresh);
    approve(fresh, bundle.root);
    recordCheck(fresh, bundle.root, { taskId: bundle.top, behindTaskId: bundle.middle });
    expect(fresh.task(bundle.root).bundleConflict ?? null).toBeNull();
  });

  test('a root that leaves its bundle drops the conflict', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    recordCheck(harness, root, { taskId: top, behindTaskId: root });
    harness.send({ type: 'task.cancel', taskId: top });
    harness.send({ type: 'task.cancel', taskId: middle });
    expect(harness.task(root).bundleConflict).toBeNull();
  });
});
