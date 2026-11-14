import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  isBundleFollower,
  isBundleMember,
  listBundleBlockers,
  listBundleFollowers,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  listStackChildren,
  listStackParents,
  listWaitsOn,
  type PullRequest,
  resolveBundle,
  resolveBundleLead,
  resolveBundleMembers,
  resolveQueue,
  resolveRoundBase,
  resolveRoundBases,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  fireRetry,
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
  const middle = createTask(harness, { request: 'Middle', stacksOn: [root] });
  const top = createTask(harness, { request: 'Top', stacksOn: [middle] });
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

function stackOn(harness: Harness, taskId: string, stacksOn: string[]) {
  harness.send({ type: 'task.stack_on_tasks', taskId, stacksOn });
}

describe('stacking a task on another', () => {
  test('a stacked task waits until the task below is ready to merge, then branches off it', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Run the chat on MCP v2' });
    const child = createTask(harness, { request: 'Embed the chat', stacksOn: [parent] });
    expect(harness.task(child).stacksOn).toEqual([parent]);
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
    expect(harness.task(child).stackBases).toEqual([`fix/${parent}`]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(child)))).toBe(`fix/${parent}`);
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
  });

  test('a task stacked on one that is already ready starts at once on its branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    reachReady(harness, parent);
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    expect(harness.task(child).stage).toBe('planning');
    expect(harness.task(child).stackBases).toEqual([`fix/${parent}`]);
  });

  test('a task below that finishes without a pull request releases the stacked one onto the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    harness.send({ type: 'task.complete', taskId: parent });
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBases ?? []).toEqual([]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(child)))).toBeNull();
  });

  test('waiting on other tasks and stacking combine in the reason', () => {
    const harness = createHarness();
    const api = createTask(harness, { request: 'Ship the API' });
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', waitsOn: [api, parent], stacksOn: [parent] });
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
    stackOn(harness, child, [parent]);
    expect(harness.task(child).waitsOn).toEqual([]);
    expect(harness.task(child).stacksOn).toEqual([parent]);
    expect(harness.task(child).stage).toBe('waiting_on_tasks');
    stackOn(harness, child, [parent]);
    expect(harness.events.filter((event) => event.type === 'task.stack_changed')).toHaveLength(1);
  });

  test('stacking a task that waits on a task further down the bundle drops that wait', () => {
    const harness = createHarness();
    const lead = createTask(harness, { request: 'Auto-ship' });
    const middle = createTask(harness, { request: 'Slack', stacksOn: [lead] });
    const top = createTask(harness, { request: 'Active hours', waitsOn: [lead] });
    stackOn(harness, top, [middle]);
    expect(harness.task(top).waitsOn).toEqual([]);
    expect(harness.task(top).stageReason).not.toContain('Auto-ship');
    reachReady(harness, lead);
    readyWorktree(harness, middle);
    reachReady(harness, middle, 43);
    expect(harness.task(top).stage).toBe('triage');
    readyWorktree(harness, top);
    expect(harness.task(top).stage).toBe('planning');
  });

  test('joining two bundles drops every wait between their tasks', () => {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base' });
    const other = createTask(harness, { request: 'Other' });
    const sibling = createTask(harness, { request: 'Sibling', stacksOn: [base], waitsOn: [other] });
    const outside = createTask(harness, { request: 'Outside' });
    harness.send({ type: 'task.wait_on', taskId: sibling, waitsOn: [other, outside] });
    stackOn(harness, other, [base]);
    expect(harness.task(other).stacksOn).toEqual([base]);
    expect(harness.task(sibling).waitsOn).toEqual([outside]);
  });

  test('a task never waits on a task in its own bundle, from wait_on or creation', () => {
    const harness = createHarness();
    const lead = createTask(harness, { request: 'Lead' });
    const middle = createTask(harness, { request: 'Middle', stacksOn: [lead] });
    const sibling = createTask(harness, { request: 'Sibling', stacksOn: [lead] });
    const top = createTask(harness, { request: 'Top', stacksOn: [middle], waitsOn: [lead, sibling] });
    expect(harness.task(top).waitsOn).toEqual([]);
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [lead, sibling] });
    harness.send({ type: 'task.wait_on', taskId: lead, waitsOn: [top] });
    expect(harness.task(top).waitsOn).toEqual([]);
    expect(harness.task(lead).waitsOn).toEqual([]);
  });

  test('a wait on a task of its own bundle already in the log holds nothing', () => {
    const harness = createHarness();
    const lead = createTask(harness, { request: 'Lead' });
    const top = createTask(harness, { request: 'Top', stacksOn: [lead] });
    const outside = createTask(harness, { request: 'Outside' });
    const stale = { ...harness.task(top), waitsOn: [lead, outside] };
    const state = { ...harness.state, tasks: { ...harness.state.tasks, [top]: stale } };
    expect(listPendingDependencies(state, stale).map((task) => task.id)).toEqual([outside, lead]);
    expect(listOpenBlockers(state, stale).map((task) => task.id)).toEqual([outside]);
  });

  test('stacking a planning task sends it back to wait, and leaving the bundle starts it again', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child' });
    const planning = harness.activeRun(child).id;
    stackOn(harness, child, [parent]);
    expect(harness.state.runs[planning]?.outcome).toBe('cancelled');
    expect(harness.task(child).stage).toBe('waiting_on_tasks');

    stackOn(harness, child, []);
    expect(harness.task(child).stacksOn).toEqual([]);
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
    stackOn(harness, child, [parent]);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBases).toEqual([`fix/${parent}`]);
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
    stackOn(harness, unsorted, [parent]);
    expect(harness.task(unsorted).stage).toBe('triage');
    expect(harness.task(unsorted).stackBases ?? []).toEqual([]);
    stackOn(harness, unsorted, [ready]);
    expect(harness.task(unsorted).stackBases).toEqual([`fix/${ready}`]);

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
    stackOn(harness, unsorted, [parent]);
    expect(harness.task(unsorted).stage).toBe('waiting_on_tasks');
  });

  test('a cancelled task below pauses the stacked one, and Retry takes it out of the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(harness.openGate(child).type).toBe('failure');
    harness.send({ type: 'task.retry', taskId: child });
    expect(harness.task(child).stacksOn).toEqual([]);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(child).stackBases ?? []).toEqual([]);
  });

  test('a task paused by a cancelled task below can stack on another one instead', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const other = createTask(harness, { request: 'Other' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(harness.openGate(child).type).toBe('failure');
    stackOn(harness, child, [other]);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(harness.task(child).stageReason).toBe('waiting for “Other” to be ready to merge');
  });

  test('a bundle is in one repository, without cycles, and only before building', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    const other = createTask(harness, { request: 'Other' });
    const refusals: [() => unknown, string][] = [
      [() => stackOn(harness, other, [other]), 'A task cannot stack on itself.'],
      [() => stackOn(harness, parent, [child]), 'That task already waits on this one.'],
    ];
    const cancelled = createTask(harness, { request: 'Cancelled' });
    harness.send({ type: 'task.cancel', taskId: cancelled });
    refusals.push([() => stackOn(harness, other, [cancelled]), 'That task was cancelled.']);
    const done = createTask(harness, { request: 'Done' });
    harness.send({ type: 'task.complete', taskId: done });
    refusals.push([
      () => stackOn(harness, other, [done]),
      'That task is finished, so there is nothing to stack on.',
    ]);
    refusals.push([() => stackOn(harness, done, [parent]), 'This task is finished.']);
    harness.send({ type: 'task.create', request: 'Why is it slow?', repoId: null, mode: 'ask' });
    const question = Object.values(harness.state.tasks).find((task) => task.mode === 'ask')?.id ?? '';
    refusals.push([
      () => stackOn(harness, other, [question]),
      'That task opens no pull request to stack on.',
    ]);
    const elsewhere = createTask(harness, { request: 'Elsewhere', repoId: registerRepo(harness, 'other') });
    refusals.push([
      () => stackOn(harness, elsewhere, [other]),
      'The tasks of a bundle work in one repository.',
    ]);
    const shipping = createTask(harness, { request: 'Shipping' });
    reachShipping(harness, shipping);
    refusals.push([
      () => stackOn(harness, shipping, [other]),
      'This task has started building, so its bundle can no longer change.',
    ]);
    for (const [refused, message] of refusals) expect(refused).toThrow(message);
    expect(() => stackOn(harness, child, [parent])).not.toThrow();
    expect(() => stackOn(harness, other, [parent])).not.toThrow();
    expect(() => stackOn(harness, elsewhere, [parent, other])).toThrow(
      'The tasks of a bundle work in one repository.'
    );
  });
});

describe('a bundle on its way to the merge', () => {
  test('the root holds its merge gate until the task stacked on it is ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
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
    createTask(harness, { request: 'Child', stacksOn: [parent] });
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
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
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
      'Approving merges the whole bundle as one, each pull request into its base from the top of the bundle down and this one last: #1 “Root”, #2 “Middle”, #3 “Top”.'
    );
    expect(listOpenGates(harness.state, top)).toHaveLength(0);
    expect(harness.task(top).stageReason).toBe(READY);
    expect(listBundleFollowers(harness.state, harness.task(root)).map((task) => task.id)).toEqual([
      middle,
      top,
    ]);
    expect(listBundleFollowers(harness.state, harness.task(top))).toEqual([]);
    expect(isBundleFollower(harness.state, harness.task(top))).toBe(true);

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
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
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

  test('a failed bundle merge puts the tasks above back to ready, and its retry opens the root’s gate again', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    harness.send({ type: 'effect.fail', taskId: root, title: 'Could not merge', detail: 'GitHub refused.' });
    expect(harness.task(root).autoRetry?.status).toBe('armed');
    for (const above of [middle, top]) expect(harness.task(above).stageReason).toBe(READY);
    fireRetry(harness, root);
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
    fireRetry(harness, root);
    recordClean(harness, root, 1);
    const gate = harness.openGate(root);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain('#1 “Root”, #2 “Middle”.');
  });

  test('a task below that merges outside Shinsa moves the one above onto the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    reachShipping(harness, child);
    expect(Option.getOrNull(resolveRoundBase(harness.task(child)))).toBe(`fix/${parent}`);
    recordClean(harness, child, 2, { checks: 'pending' });
    const watches = harness.effectsOf('pull_request.watch').length;
    recordMerged(harness, parent, 1);
    expect(harness.task(child).stackBases).toEqual([]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(child)))).toBeNull();
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
    expect(harness.task(middle).stackBases).toEqual([]);
    recordClean(harness, middle, 2);
    const gate = harness.openGate(middle);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain('#2 “Middle”, #3 “Top”.');
  });

  test('a cancelled task below pauses the started one above, and Retry takes it out of the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
    harness.send({ type: 'task.cancel', taskId: parent });
    const gate = harness.openGate(child);
    expect(gate.title).toBe('“Parent” was cancelled');
    expect(harness.task(child).stackBases).toEqual([`fix/${parent}`]);
    approve(harness, child);
    expect(harness.task(child).stacksOn).toEqual([]);
    expect(harness.task(child).stackBases).toEqual([]);
    expect(harness.task(child).stage).toBe('planning');
  });

  test('taking a planning task out of its bundle replans it from the default branch', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    reachReady(harness, parent, 1);
    readyWorktree(harness, child);
    expect(harness.task(child).stackBases).toEqual([`fix/${parent}`]);
    const creates = harness.effectsOf('worktree.create').length;
    stackOn(harness, child, []);
    expect(harness.task(child).stacksOn).toEqual([]);
    expect(harness.task(child).stackBases).toEqual([]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(child)))).toBeNull();
    verifySetup(harness, child);
    expect(harness.effectsOf('worktree.create').length).toBe(creates + 1);
    expect(harness.task(parent).bundleReady).toBeNull();
  });

  test('the root gets its own merge gate once nothing is stacked on it any more', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', stacksOn: [parent] });
    reachReady(harness, parent, 1);
    stackOn(harness, child, []);
    expect(harness.task(parent).bundleReady).toBeNull();
    expect(harness.task(parent).stageReason).toBe('checking the pull request');
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(parent);
    recordClean(harness, parent, 1);
    expect(harness.openGate(parent).type).toBe('merge');

    const other = createTask(harness, { request: 'Other', stacksOn: [parent] });
    expect(listOpenGates(harness.state, parent)).toHaveLength(0);
    harness.send({ type: 'task.cancel', taskId: other });
    recordClean(harness, parent, 1);
    expect(harness.openGate(parent).type).toBe('merge');
  });

  test('a ready task that waits on another task to merge stops being ready', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    createTask(harness, { request: 'Child', stacksOn: [parent] });
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
      stacksOn: [parent],
    });
    reachReady(harness, parent);
    expect(harness.openGate(parent).type).toBe('merge');
  });

  test('a question stacked on a bundle is no member, so it keeps its wait on another member', () => {
    const harness = createHarness();
    const lead = createTask(harness, { request: 'Lead' });
    const sibling = createTask(harness, { request: 'Sibling', stacksOn: [lead] });
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({
      type: 'task.create',
      request: 'Why is it slow?',
      repoId: null,
      mode: 'ask',
      waitsOn: [sibling],
    });
    const question = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    stackOn(harness, question, [lead]);
    expect(harness.task(question).waitsOn).toEqual([sibling]);
    expect(isBundleMember(harness.state, harness.task(question), sibling)).toBe(false);
    expect(listPendingDependencies(harness.state, harness.task(question)).map((task) => task.id)).toContain(
      sibling
    );
  });

  test('a question stacked on the task it waits on moves that wait into the stack', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({
      type: 'task.create',
      request: 'Why is it slow?',
      repoId: null,
      mode: 'ask',
      waitsOn: [parent],
    });
    const question = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
    stackOn(harness, question, [parent]);
    expect(harness.task(question).waitsOn).toEqual([]);
    expect(harness.task(question).stacksOn).toEqual([parent]);
  });

  test('a follow-up on a merged task keeps it out of the bundle it left', () => {
    const harness = createHarness();
    const merged = createTask(harness, { request: 'Merged' });
    const busy = createTask(harness, { request: 'Busy' });
    const above = createTask(harness, { request: 'Above', stacksOn: [merged], waitsOn: [busy] });
    reachReady(harness, merged, 1);
    recordMerged(harness, merged, 1);
    const waiter = createTask(harness, { request: 'Waiter', waitsOn: [merged] });
    const child = createTask(harness, { request: 'Child', stacksOn: [above, waiter] });
    expect(harness.task(above).stageReason).toBe('waiting for “Busy” to finish');
    harness.send({ type: 'task.message', taskId: merged, text: 'Why this approach?' });
    expect(harness.task(merged)).toMatchObject({ stage: 'answering', bundleReady: null });
    expect(harness.task(above).stageReason).toBe('waiting for “Busy” to finish');
    expect(listPendingDependencies(harness.state, harness.task(above)).map((task) => task.id)).toEqual([
      busy,
    ]);
    expect(isBundleMember(harness.state, harness.task(waiter), merged)).toBe(false);
    expect(isBundleMember(harness.state, harness.task(merged), waiter)).toBe(false);
    expect(resolveBundleMembers(harness.state, harness.task(merged)).map((task) => task.id)).toEqual([
      merged,
    ]);
    expect(resolveBundleMembers(harness.state, harness.task(child)).map((task) => task.id)).toEqual([
      above,
      waiter,
      child,
    ]);
  });

  test('a loose task is in no bundle', () => {
    const harness = createHarness();
    const loose = createTask(harness, { request: 'Loose' });
    expect(resolveBundle(harness.state, harness.task(loose))).toEqual([]);
    expect(isBundleFollower(harness.state, harness.task(loose))).toBe(false);
    expect(listBundleFollowers(harness.state, harness.task(loose))).toEqual([]);
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
    expect(harness.task(root).autoRetry).toMatchObject({
      title: 'The bundle conflicts with main',
      attempt: 1,
    });
    recordCheck(harness, root, { taskId: top, behindTaskId: null });
    expect(harness.task(root).autoRetry?.attempt).toBe(1);
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

function recordMergeConflict(
  harness: Harness,
  taskId: string,
  conflict: { taskId: string; behindTaskId: string | null }
) {
  harness.send({ type: 'bundle.record_merge_conflict', taskId, conflict: { ...conflict, base: 'main' } });
}

describe('a bundle that conflicts with the default branch when it merges', () => {
  test('the merge sends the bundle back to update the lowest branch behind, then the gate opens again', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    expect(harness.task(middle).stage).toBe('awaiting_merge');
    recordMergeConflict(harness, root, { taskId: top, behindTaskId: middle });
    expect(harness.task(root).stage).toBe('shipping');
    expect(harness.task(root).stageReason).toBe(
      '“Top” conflicts with main once the bundle merges; updating “Middle” first'
    );
    expect(listOpenGates(harness.state, root)).toHaveLength(0);
    expect(harness.task(root).autoRetry ?? null).toBeNull();
    expect(harness.task(top).stage).toBe('shipping');
    expect(harness.task(top).stageReason).toBe(READY);
    expect(harness.task(middle).stageReason).toBe('updating the branch onto main');
    expect(harness.lastEffect('pull_request.push').taskId).toBe(middle);

    pushed(harness, middle);
    recordClean(harness, middle, 2);
    recordCheck(harness, root, null);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');
  });

  test('the lead itself behind is updated first', () => {
    const harness = createHarness();
    const { root, top } = createBundle(harness);
    approve(harness, root);
    recordMergeConflict(harness, root, { taskId: top, behindTaskId: root });
    expect(harness.task(root).stageReason).toBe('updating the branch onto main');
    expect(harness.lastEffect('pull_request.push').taskId).toBe(root);
  });

  test('a conflict with no branch behind pauses the lead and releases its followers', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    recordMergeConflict(harness, root, { taskId: top, behindTaskId: null });
    expect(harness.task(root).autoRetry).toMatchObject({ title: 'The bundle conflicts with main' });
    expect(harness.task(middle).stageReason).toBe(READY);
    expect(harness.task(top).stageReason).toBe(READY);
  });

  test('a lead that is not merging ignores it', () => {
    const harness = createHarness();
    const { root, top } = createBundle(harness);
    const before = harness.state;
    recordMergeConflict(harness, root, { taskId: top, behindTaskId: root });
    expect(harness.state).toBe(before);
  });

  test('a lead whose followers left while it merged checks its pull request again instead of staying merging', () => {
    const harness = createHarness();
    const { root, middle, top } = createBundle(harness);
    approve(harness, root);
    harness.send({ type: 'task.cancel', taskId: top });
    harness.send({ type: 'task.cancel', taskId: middle });
    expect(harness.task(root).stage).toBe('awaiting_merge');
    recordMergeConflict(harness, root, { taskId: top, behindTaskId: null });
    expect(harness.task(root).stage).toBe('shipping');
    expect(harness.task(root).stageReason).toBe('checking the pull request');
    expect(harness.task(root).bundleConflict ?? null).toBeNull();
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(root);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');

    const lone = createHarness();
    const task = createTask(lone, { request: 'Lone' });
    reachReady(lone, task, 1);
    approve(lone, task);
    recordMergeConflict(lone, task, { taskId: task, behindTaskId: task });
    expect(lone.task(task).stageReason).toBe('checking the pull request');
  });
});

function createDiamond(harness: Harness) {
  const a = createTask(harness, { request: 'A' });
  const b = createTask(harness, { request: 'B', stacksOn: [a] });
  const c = createTask(harness, { request: 'C', stacksOn: [a] });
  const d = createTask(harness, { request: 'D', stacksOn: [a] });
  const f = createTask(harness, { request: 'F', stacksOn: [b, c, d] });
  const e = createTask(harness, { request: 'E', stacksOn: [f] });
  return { a, b, c, d, f, e };
}

function readyDiamond(harness: Harness) {
  const tasks = createDiamond(harness);
  const { a, b, c, d, f, e } = tasks;
  reachReady(harness, a, 1);
  for (const [id, number] of [
    [b, 2],
    [c, 3],
    [d, 4],
  ] as const) {
    readyWorktree(harness, id);
    reachReady(harness, id, number);
  }
  readyWorktree(harness, f);
  reachReady(harness, f, 5);
  readyWorktree(harness, e);
  reachReady(harness, e, 6);
  recordClean(harness, a, 1);
  return tasks;
}

describe('a bundle that branches and joins', () => {
  test('a task stacked on several tasks waits for every one of them, then branches off the first', () => {
    const harness = createHarness();
    const { a, b, c, d, f } = createDiamond(harness);
    expect(harness.task(f).stacksOn).toEqual([b, c, d]);
    expect(harness.task(f).activity.map((entry) => entry.text)).toContain(
      'Stacked on “B”, “C” and “D” as a bundle'
    );
    reachReady(harness, a, 1);
    expect(harness.task(f).stageReason).toBe('waiting for “B”, “C”, “D” to be ready to merge');
    for (const [id, number] of [
      [b, 2],
      [c, 3],
    ] as const) {
      readyWorktree(harness, id);
      reachReady(harness, id, number);
    }
    expect(harness.task(f).stageReason).toBe('waiting for “D” to be ready to merge');
    readyWorktree(harness, d);
    reachReady(harness, d, 4);
    expect(harness.task(f).stage).toBe('triage');
    expect(harness.task(f).stackBases).toEqual([`fix/${b}`, `fix/${c}`, `fix/${d}`]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(f)))).toBe(`fix/${b}`);
    expect(resolveRoundBases(harness.task(f))).toEqual([`fix/${b}`, `fix/${c}`, `fix/${d}`]);
  });

  test('the bundle is every connected task, parents first, and its earliest root leads it', () => {
    const harness = createHarness();
    const { a, b, c, d, f, e } = createDiamond(harness);
    const order = [a, b, c, d, f, e];
    for (const id of order) {
      expect(resolveBundleMembers(harness.state, harness.task(id)).map((task) => task.id)).toEqual(order);
      expect(resolveBundleLead(harness.state, harness.task(id)).id).toBe(a);
    }
    expect(listBundleFollowers(harness.state, harness.task(a)).map((task) => task.id)).toEqual([
      b,
      c,
      d,
      f,
      e,
    ]);
    expect(resolveBundle(harness.state, harness.task(c)).map((task) => task.id)).toEqual(order);
    expect(listStackParents(harness.state, harness.task(f)).map((task) => task.id)).toEqual([b, c, d]);
    expect(listStackChildren(harness.state, a).map((task) => task.id)).toEqual([b, c, d]);
  });

  test('the lead holds one merge gate, and approving it merges from the top down', () => {
    const harness = createHarness();
    const { a, b, c, d, f, e } = readyDiamond(harness);
    const gate = harness.openGate(a);
    expect(gate.type).toBe('merge');
    expect(gate.body).toContain('#1 “A”, #2 “B”, #3 “C”, #4 “D”, #5 “F”, #6 “E”.');
    for (const id of [b, c, d, f, e]) {
      expect(listOpenGates(harness.state, id)).toHaveLength(0);
      expect(harness.task(id).stageReason).toBe(READY);
    }
    approve(harness, a);
    expect(harness.lastEffect('pull_request.merge').bundle).toEqual([
      { taskId: e, number: 6 },
      { taskId: f, number: 5 },
      { taskId: d, number: 4 },
      { taskId: c, number: 3 },
      { taskId: b, number: 2 },
    ]);
    for (const [id, number] of [
      [e, 6],
      [f, 5],
      [d, 4],
      [c, 3],
      [b, 2],
      [a, 1],
    ] as const) {
      recordMerged(harness, id, number);
    }
    expect([a, b, c, d, f, e].map((id) => harness.task(id).stage)).toEqual(Array(6).fill('merged'));
  });

  test('a task stacked on several waits as ready while one of them is still busy', () => {
    const harness = createHarness();
    const { a, c, f } = readyDiamond(harness);
    recordClean(harness, c, 3, { checks: 'failing' });
    expect(harness.task(c).stage).toBe('fixing');
    expect(listOpenGates(harness.state, a)).toHaveLength(0);
    expect(harness.task(a).stageReason).toBe('waiting for “C” to be ready to merge');
    expect(harness.task(f).stageReason).toBe(READY);
  });

  test('a first parent that merges outside Shinsa moves the pull request onto the next one', () => {
    const harness = createHarness();
    const { b, c, d, f } = readyDiamond(harness);
    const watches = harness.effectsOf('pull_request.watch').length;
    recordMerged(harness, b, 2);
    expect(harness.task(f).stackBases).toEqual([`fix/${c}`, `fix/${d}`]);
    expect(Option.getOrNull(resolveRoundBase(harness.task(f)))).toBe(`fix/${c}`);
    expect(
      harness
        .effectsOf('pull_request.watch')
        .slice(watches)
        .map((effect) => effect.taskId)
    ).toContain(f);
  });

  test('a cancelled parent pauses the task stacked on it, and Retry keeps the others', () => {
    const harness = createHarness();
    const { b, c, d, f } = readyDiamond(harness);
    harness.send({ type: 'task.cancel', taskId: c });
    const gate = harness.openGate(f);
    expect(gate.title).toBe('“C” was cancelled');
    expect(gate.body).toContain('Retry to keep it stacked on “B”, “D” only, or cancel this one.');
    approve(harness, f);
    expect(harness.task(f).stacksOn).toEqual([b, d]);
    expect(harness.task(f).stackBases).toEqual([`fix/${b}`, `fix/${d}`]);
  });

  test('a waiting task with a cancelled parent keeps waiting on the rest after Retry', () => {
    const harness = createHarness();
    const { b, c, d, f } = createDiamond(harness);
    harness.send({ type: 'task.cancel', taskId: c });
    expect(harness.openGate(f).type).toBe('failure');
    harness.send({ type: 'task.retry', taskId: f });
    expect(harness.task(f).stacksOn).toEqual([b, d]);
    expect(harness.task(f).stage).toBe('waiting_on_tasks');
  });

  test('a bundle with two roots leads from the earlier one, and the later root waits as ready', () => {
    const harness = createHarness();
    const first = createTask(harness, { request: 'First root' });
    const second = createTask(harness, { request: 'Second root' });
    const join = createTask(harness, { request: 'Join', stacksOn: [first, second] });
    reachReady(harness, second, 2);
    expect(listOpenGates(harness.state, second)).toHaveLength(0);
    expect(harness.task(second).stageReason).toBe(READY);
    reachReady(harness, first, 1);
    readyWorktree(harness, join);
    reachReady(harness, join, 3);
    recordClean(harness, first, 1);
    expect(harness.openGate(first).type).toBe('merge');
    approve(harness, first);
    expect(harness.lastEffect('pull_request.merge').bundle).toEqual([
      { taskId: join, number: 3 },
      { taskId: second, number: 2 },
    ]);
  });

  test('a task at its merge gate that joins a bundle behind an earlier root gives its gate up', () => {
    const harness = createHarness();
    const first = createTask(harness, { request: 'First root' });
    const later = createTask(harness, { request: 'Later root' });
    reachReady(harness, later, 2);
    expect(harness.openGate(later).type).toBe('merge');
    createTask(harness, { request: 'Join', stacksOn: [first, later] });
    expect(listOpenGates(harness.state, later)).toHaveLength(0);
    expect(harness.task(later).stageReason).toBe(READY);
    expect(resolveBundleLead(harness.state, harness.task(later)).id).toBe(first);
  });

  test('stacking keeps the order of the tasks given, and the same list again changes nothing', () => {
    const harness = createHarness();
    const one = createTask(harness, { request: 'One' });
    const two = createTask(harness, { request: 'Two' });
    const child = createTask(harness, { request: 'Child', waitsOn: [two] });
    stackOn(harness, child, [two, one, two]);
    expect(harness.task(child).stacksOn).toEqual([two, one]);
    expect(harness.task(child).waitsOn).toEqual([]);
    stackOn(harness, child, [two, one]);
    stackOn(harness, child, [one, two]);
    expect(harness.events.filter((event) => event.type === 'task.stack_changed')).toHaveLength(2);
    expect(harness.task(child).activity.map((entry) => entry.text)).toContain(
      'Stacked on “Two” and “One” as a bundle'
    );
  });
});

describe('a bundle on Home', () => {
  test('ready tasks of a bundle wait on the ones still working, and parallel ones all show as working', () => {
    const harness = createHarness();
    const root = createTask(harness, { request: 'Root' });
    const left = createTask(harness, { request: 'Left', stacksOn: [root] });
    const right = createTask(harness, { request: 'Right', stacksOn: [root] });
    reachReady(harness, root, 1);
    readyWorktree(harness, left);
    readyWorktree(harness, right);
    expect(harness.task(left).stage).toBe('planning');
    expect(harness.task(right).stage).toBe('planning');

    const queue = resolveQueue(harness.state, 0);
    expect(queue.working.map((task) => task.id).sort()).toEqual([left, right].sort());
    expect(queue.waiting.map((task) => task.id)).toEqual([root]);
    expect(
      listBundleBlockers(harness.state, harness.task(root))
        .map((task) => task.id)
        .sort()
    ).toEqual([left, right].sort());

    reachReady(harness, left, 2);
    const later = resolveQueue(harness.state, 0);
    expect(later.working.map((task) => task.id)).toEqual([right]);
    expect(later.waiting.map((task) => task.id).sort()).toEqual([root, left].sort());
    expect(listBundleBlockers(harness.state, harness.task(left)).map((task) => task.id)).toEqual([right]);
    expect(listBundleBlockers(harness.state, harness.task(right))).toEqual([]);

    reachReady(harness, right, 3);
    recordClean(harness, root, 1);
    expect(harness.openGate(root).type).toBe('merge');
    const merging = resolveQueue(harness.state, 0);
    expect(merging.working).toEqual([]);
    expect(merging.waiting.map((task) => task.id).sort()).toEqual([left, right].sort());
    expect(listBundleBlockers(harness.state, harness.task(left)).map((task) => task.id)).toEqual([root]);
    expect(listBundleBlockers(harness.state, harness.task(root))).toEqual([]);
  });
});

function triageNew(
  harness: Harness,
  options: { request: string; stacksOn: string[]; waitsOn?: string[]; repoId?: string; shape?: 'answer' }
) {
  const repoId = options.repoId ?? Object.keys(harness.state.repos)[0] ?? registerRepo(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request: options.request, repoId });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: options.request,
    repoId,
    size: 'large',
    branch: `feat/${taskId}`,
    waitsOn: options.waitsOn ?? [],
    stacksOn: options.stacksOn,
    ...(options.shape ? { shape: options.shape } : {}),
    reasons: { start: 'It needs no other task.', stack: 'It is the next piece of the rewrite.' },
  });
  return taskId;
}

describe('triage stacking a new task', () => {
  test('stacks the next piece of an open change, records why, and moves a wait on it into the bundle', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Rewrite the store in Effect' });
    const other = createTask(harness, { request: 'Add the share preset' });
    const child = triageNew(harness, {
      request: 'Move the outbox onto the new store',
      stacksOn: [parent],
      waitsOn: [parent, other],
    });
    const task = harness.task(child);
    expect(task.stacksOn).toEqual([parent]);
    expect(task.waitsOn).toEqual([other]);
    expect(task.triageDecisions?.stack).toEqual({
      value: [parent],
      why: 'It is the next piece of the rewrite.',
    });
    expect(task.triageDecisions?.start?.value).toEqual([other]);
    expect(task.stage).toBe('waiting_on_tasks');
    expect(task.activity.map((entry) => entry.text)).toContain(
      'Stacked on “Rewrite the store in Effect” as a bundle'
    );
  });

  test('never infers a wait on a task further down the bundle it stacks on', () => {
    const harness = createHarness();
    const lead = createTask(harness, { request: 'Lead' });
    const middle = createTask(harness, { request: 'Middle', stacksOn: [lead] });
    const outside = createTask(harness, { request: 'Outside' });
    const top = triageNew(harness, { request: 'Top', stacksOn: [middle], waitsOn: [lead, outside] });
    expect(harness.task(top).stacksOn).toEqual([middle]);
    expect(harness.task(top).waitsOn).toEqual([outside]);
  });

  test('an empty stack records no stack decision and starts at once', () => {
    const harness = createHarness();
    createTask(harness, { request: 'Parent' });
    const child = triageNew(harness, { request: 'Child', stacksOn: [] });
    expect(harness.task(child).stacksOn ?? []).toEqual([]);
    expect(harness.task(child).triageDecisions?.stack).toBeUndefined();
    expect(harness.task(child).stage).toBe('triage');
  });

  test('is dropped across repositories, for work that opens no pull request, and on a finished task', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const elsewhere = registerRepo(harness, 'other');
    const across = triageNew(harness, { request: 'Across', stacksOn: [parent], repoId: elsewhere });
    expect(harness.task(across).stacksOn ?? []).toEqual([]);
    const question = triageNew(harness, {
      request: 'How does it work?',
      stacksOn: [parent],
      shape: 'answer',
    });
    expect(harness.task(question).stacksOn ?? []).toEqual([]);
    const finished = createTask(harness, { request: 'Finished' });
    harness.send({ type: 'task.cancel', taskId: finished });
    const late = triageNew(harness, { request: 'Late', stacksOn: [finished, 'missing'] });
    expect(harness.task(late).stacksOn ?? []).toEqual([]);
    expect(harness.task(late).triageDecisions?.stack).toBeUndefined();
  });

  test('never stacks a task whose start you chose', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const repoId = harness.task(parent).repoId ?? '';
    harness.send({ type: 'task.create', request: 'Mine', repoId, waitsOn: [] });
    const mine = Object.values(harness.state.tasks).find((task) => task.request === 'Mine')?.id ?? '';
    harness.send({
      type: 'task.triage',
      taskId: mine,
      title: 'Mine',
      repoId,
      size: 'small',
      branch: 'fix/mine',
      waitsOn: [],
      stacksOn: [parent],
    });
    expect(harness.task(mine).stacksOn ?? []).toEqual([]);
  });
});
