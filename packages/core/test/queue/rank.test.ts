import { describe, expect, test } from 'bun:test';
import { listWaitsOn, resolveFocusArea, resolveQueue } from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  proposePlan,
  pullRequest,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

describe('attention', () => {
  test('only the attention limit is up now; the rest waits later', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { attentionLimit: 1 } });
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'a', question: 'One?', context: null });
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'b', question: 'Two?', context: null });
    const queue = resolveQueue(harness.state, 0);
    expect(queue.upNow).toHaveLength(1);
    expect(queue.later).toHaveLength(1);
  });

  test('the queue holds gates outside the focused area', () => {
    const harness = createHarness();
    harness.send({ type: 'area.write', area: { id: 'side', name: 'Side projects', color: 'blue' } });
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Which tab?',
      context: null,
    });
    expect(resolveQueue(harness.state, 2_000).ready).toHaveLength(1);
    harness.send({ type: 'focus.change', areaId: 'side', until: null });
    const queue = resolveQueue(harness.state, 2_000);
    expect(queue.ready).toHaveLength(0);
    expect(queue.held.map((entry) => entry.task.id)).toEqual([taskId]);
  });
});

describe('ranking decisions', () => {
  test('priority first, then what a decision unblocks, then the kind of gate, then age', () => {
    const harness = createHarness();
    const review = createTask(harness, { intent: 'Review me' });
    reachReviewGate(harness, review);
    const shipped = createTask(harness, { intent: 'Merge me' });
    reachShipping(harness, shipped);
    harness.send({ type: 'pull_request.record', taskId: shipped, pullRequest: pullRequest() });
    const parent = createTask(harness, { intent: 'Parent' });
    reachReviewGate(harness, parent);
    createTask(harness, { intent: 'Child', blockedBy: [parent] });
    const urgent = createTask(harness, { intent: 'Urgent', priority: 'urgent' });
    reachReviewGate(harness, urgent);
    const queue = resolveQueue(harness.state, 0);
    expect(queue.ready.map((entry) => `${entry.task.title}: ${entry.reason}`)).toEqual([
      'Urgent: Marked high priority',
      'Parent: Unblocks 1 other task',
      'Merge me: Clean and ready to merge',
      'Review me: Built, checked and ready for you',
    ]);
  });

  test('a task marked done no longer counts as unblocked', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    reachReviewGate(harness, parent);
    const child = createTask(harness, { intent: 'Child', blockedBy: [parent] });
    harness.send({ type: 'task.complete', taskId: child });
    expect(resolveQueue(harness.state, 0).ready[0]?.unblocks).toBe(0);
  });

  test('a paused task and a plan to approve say why they need you', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const planned = createTask(harness, { intent: 'Plan me', size: 'large' });
    proposePlan(harness, planned);
    const paused = createTask(harness, { intent: 'Pause me' });
    harness.send({ type: 'effect.fail', taskId: paused, title: 'Broke', detail: 'x' });
    const reasons = resolveQueue(harness.state, 0).ready.map((entry) => entry.reason);
    expect(reasons).toContain('Needs the plan approved before building starts');
    expect(reasons).toContain('Paused and needs a decision');
  });
});

describe('what is working and what is waiting', () => {
  test('a task being merged still shows as working, a task waiting on another as waiting', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    reachShipping(harness, parent);
    harness.send({ type: 'pull_request.record', taskId: parent, pullRequest: pullRequest() });
    approve(harness, parent);
    const child = createTask(harness, { intent: 'Child', blockedBy: [parent] });
    const queue = resolveQueue(harness.state, 0);
    expect(queue.working.map((task) => task.id)).toEqual([parent]);
    expect(queue.waiting.map((task) => task.id)).toEqual([child]);
    expect(listWaitsOn(harness.state, harness.task(child)).map((task) => task.id)).toEqual([parent]);
  });

  test('settled tasks are neither working nor waiting', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    const queue = resolveQueue(harness.state, 0);
    expect([...queue.working, ...queue.waiting]).toHaveLength(0);
    expect(listWaitsOn(harness.state, harness.task(taskId))).toEqual([]);
  });

  test('a focus with an end date stops focusing once it passes', () => {
    const harness = createHarness();
    harness.send({ type: 'area.write', area: { id: 'side', name: 'Side', color: 'blue' } });
    harness.send({ type: 'focus.change', areaId: 'side', until: 5_000 });
    expect(resolveFocusArea(harness.state, 4_999)).toBe('side');
    expect(resolveFocusArea(harness.state, 5_000)).toBeNull();
  });
});
