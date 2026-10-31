import { describe, expect, test } from 'bun:test';
import { type Gate, listWaitsOn, resolveFocusProject, resolveQueue, type Task } from '../../src/index.ts';
import { resolveGateWords } from '../../src/queue/reasons.ts';
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

  test('a focus on a project lists only its decisions, and names each gate’s project', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Side projects', color: 'blue' } });
    const side = Object.keys(harness.state.projects)[0] ?? '';
    const taskId = createTask(harness);
    const superwall = harness.task(taskId).projectId ?? null;
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Which tab?',
      context: null,
    });
    const before = resolveQueue(harness.state, 2_000);
    expect(before.focusProjectId).toBeNull();
    expect(before.ready.map((entry) => entry.projectId)).toEqual([superwall]);
    harness.send({ type: 'focus.change', projectId: side, until: null });
    const queue = resolveQueue(harness.state, 2_000);
    expect(queue.focusProjectId).toBe(side);
    expect(queue.ready).toHaveLength(0);
    harness.send({ type: 'focus.change', projectId: superwall, until: null });
    expect(resolveQueue(harness.state, 2_000).ready.map((entry) => entry.task.id)).toEqual([taskId]);
  });
});

describe('ranking decisions', () => {
  test('priority first, then what a decision unblocks, then the kind of gate, then age', () => {
    const harness = createHarness();
    const review = createTask(harness, { request: 'Review me' });
    reachReviewGate(harness, review);
    const shipped = createTask(harness, { request: 'Merge me' });
    reachShipping(harness, shipped);
    harness.send({ type: 'pull_request.record', taskId: shipped, pullRequest: pullRequest() });
    const parent = createTask(harness, { request: 'Parent' });
    reachReviewGate(harness, parent);
    createTask(harness, { request: 'Child', waitsOn: [parent] });
    const urgent = createTask(harness, { request: 'Urgent', priority: 'urgent' });
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
    const parent = createTask(harness, { request: 'Parent' });
    reachReviewGate(harness, parent);
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
    harness.send({ type: 'task.complete', taskId: child });
    expect(resolveQueue(harness.state, 0).ready[0]?.unblocks).toBe(0);
  });

  test('a paused task and a plan to approve say why they need you', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const planned = createTask(harness, { request: 'Plan me', size: 'large' });
    proposePlan(harness, planned);
    const paused = createTask(harness, { request: 'Pause me' });
    harness.send({ type: 'effect.fail', taskId: paused, title: 'Broke', detail: 'x' });
    const reasons = resolveQueue(harness.state, 0).ready.map((entry) => entry.reason);
    expect(reasons).toEqual([
      'Needs the plan approved before building starts',
      'Paused and needs a decision',
    ]);
  });

  test('an agent asking for a secret says so, not that it waits on an answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.request_secret',
      runId: harness.activeRun(taskId).id,
      gateId: 'g1',
      label: 'GitHub webhook secret',
      reason: 'Paste the signing secret.',
    });
    expect(resolveQueue(harness.state, 0).ready.map((entry) => entry.reason)).toEqual([
      'An agent needs a secret from you',
    ]);
  });
});

describe('what is working and what is waiting', () => {
  test('a task being merged still shows as working, a task waiting on another as waiting', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    reachShipping(harness, parent);
    harness.send({ type: 'pull_request.record', taskId: parent, pullRequest: pullRequest() });
    approve(harness, parent);
    const child = createTask(harness, { request: 'Child', waitsOn: [parent] });
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
    harness.send({ type: 'project.write', project: { name: 'Side', color: 'blue' } });
    const side = Object.keys(harness.state.projects)[0] ?? '';
    harness.send({ type: 'focus.change', projectId: side, until: 5_000 });
    expect(resolveFocusProject(harness.state, 4_999)).toBe(side);
    expect(resolveFocusProject(harness.state, 5_000)).toBeNull();
  });

  test('a gate after the merge says what is left', () => {
    const gate = { type: 'post_merge', title: '2 post-merge steps left' } as Gate;
    expect(resolveGateWords(gate).why(gate, {} as Task)).toBe(
      'Merged, and the task is done once you do the steps it left for you: 2 post-merge steps left'
    );
  });

  test('an answered task says it moves to Done once you close it', () => {
    const gate = { type: 'result', title: 'Read the answer' } as Gate;
    expect(resolveGateWords(gate)).toMatchObject({ label: 'Answered' });
    expect(resolveGateWords(gate).why(gate, {} as Task)).toBe(
      'Read the answer, and the task moves to Done once you close it'
    );
  });
});
