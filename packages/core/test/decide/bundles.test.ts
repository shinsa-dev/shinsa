import { describe, expect, test } from 'bun:test';
import { listOpenGates, listWaitsOn, resolveRoundBase } from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  pullRequest,
  reachShipping,
  readyWorktree,
  registerRepo,
} from '../harness.ts';

function reachReady(harness: Harness, taskId: string) {
  if (harness.task(taskId).stage !== 'shipping') reachShipping(harness, taskId);
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ checks: 'none' }),
    ci: 'none',
  });
  expect(harness.openGate(taskId).type).toBe('merge');
}

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
    const unsorted =
      Object.values(harness.state.tasks).find((task) => task.request === 'Unsorted')?.id ?? '';
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
