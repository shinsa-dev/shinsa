import { describe, expect, test } from 'bun:test';
import { traceStalledLeaf } from '../../src/index.ts';
import { createHarness, createTask, reachReviewGate } from '../harness.ts';

describe('traceStalledLeaf', () => {
  test('walks a chain to the task that is stuck on you, with the path to it', () => {
    const harness = createHarness();
    const root = createTask(harness, { request: 'Root' });
    const middle = createTask(harness, { request: 'Middle', waitsOn: [root] });
    const leaf = createTask(harness, { request: 'Leaf', waitsOn: [middle] });
    expect(traceStalledLeaf(harness.state, harness.task(leaf))).toBeNull();
    reachReviewGate(harness, root);
    expect(traceStalledLeaf(harness.state, harness.task(leaf))).toMatchObject({
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
    expect(traceStalledLeaf(harness.state, harness.task(child))?.reason).toBe('paused');
    harness.send({ type: 'task.cancel', taskId: parent });
    expect(traceStalledLeaf(harness.state, harness.task(child))).toMatchObject({
      task: { id: parent },
      reason: 'cancelled',
      gate: null,
    });
    const grandchild = createTask(harness, { request: 'Grandchild', waitsOn: [child] });
    expect(traceStalledLeaf(harness.state, harness.task(grandchild))).toMatchObject({
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
    expect(traceStalledLeaf(harness.state, harness.task(d))).toBeNull();
  });
});
