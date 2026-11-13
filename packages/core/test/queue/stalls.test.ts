import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { traceStalledLeaf } from '../../src/index.ts';
import { approve, createHarness, createTask, pullRequest, pushed, reachReviewGate } from '../harness.ts';

describe('traceStalledLeaf', () => {
  test('walks a chain to the task that is stuck on you, with the path to it', () => {
    const harness = createHarness();
    const root = createTask(harness, { request: 'Root' });
    const middle = createTask(harness, { request: 'Middle', waitsOn: [root] });
    const leaf = createTask(harness, { request: 'Leaf', waitsOn: [middle] });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(leaf)))).toBeNull();
    reachReviewGate(harness, root);
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(leaf)))).toMatchObject({
      task: { id: root },
      reason: 'needs_you',
      path: [{ id: middle }, { id: root }],
    });
  });

  test('a paused or cancelled parent is the stalled leaf', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
    harness.send({ type: 'effect.fail', taskId: parent, title: 'Broke', detail: 'x' });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(child)))?.reason).toBe('paused');
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(child)))).toMatchObject({
      task: { id: parent },
      reason: 'cancelled',
      gate: null,
    });
    const grandchild = createTask(harness, { request: 'Grandchild', waitsOn: [child] });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(grandchild)))).toMatchObject({
      task: { id: child },
      reason: 'paused',
      path: [{ id: child }],
    });
  });

  test('visits a diamond once', () => {
    const harness = createHarness();
    const a = createTask(harness, { request: 'A' });
    const b = createTask(harness, { request: 'B', waitsOn: [a] });
    const c = createTask(harness, { request: 'C', waitsOn: [a] });
    const d = createTask(harness, { request: 'D', waitsOn: [b, c] });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(d)))).toBeNull();
  });

  test('a parent whose review is held by its own wait is not stuck on you: the trace goes on to what it waits on', () => {
    const harness = createHarness();
    const root = createTask(harness, { request: 'Root' });
    const parent = createTask(harness, { request: 'Parent' });
    reachReviewGate(harness, parent);
    harness.send({ type: 'task.wait_on', taskId: parent, waitsOn: [root] });
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(child)))).toBeNull();
    reachReviewGate(harness, root);
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(child)))).toMatchObject({
      task: { id: root },
      reason: 'needs_you',
      path: [{ id: parent }, { id: root }],
    });
    approve(harness, root);
    pushed(harness, root);
    harness.send({
      type: 'pull_request.record',
      taskId: root,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(Option.getOrNull(traceStalledLeaf(harness.state, harness.task(child)))).toMatchObject({
      task: { id: parent },
      reason: 'needs_you',
      path: [{ id: parent }],
    });
  });
});
