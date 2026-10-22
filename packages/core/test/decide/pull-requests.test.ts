import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  pullRequest,
  pushed,
  pushFix,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

function shipping() {
  const harness = createHarness();
  const taskId = createTask(harness);
  reachShipping(harness, taskId);
  return { harness, taskId };
}

describe('opening the pull request', () => {
  test('approving the review asks for a push and opens the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'opening the pull request',
    });
    expect(harness.task(taskId).pushPending).toBe(true);
    expect(harness.lastEffect('pull_request.open').taskId).toBe(taskId);
    pushed(harness, taskId, 'abc');
    expect(harness.task(taskId)).toMatchObject({ pushPending: false, pushedSha: 'abc' });
  });

  test('a recorded pull request is opened once and updated after that', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    const opened = harness.task(taskId).activity.filter((entry) => entry.kind === 'pull_request');
    expect(opened.map((entry) => entry.text)).toEqual(['Opened pull request #42']);
  });
});

describe('reacting to the pull request', () => {
  test('a clean pull request opens the merge gate; a failing one is fixed and pushed', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'pending', mergeable: null }),
    });
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);

    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(harness.task(taskId).fixFor).toBe('pull_request');
    expect(harness.activeRun(taskId).prompt).toContain('CI checks are failing');
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'pushing the fix' });
    expect(harness.lastEffect('pull_request.push').taskId).toBe(taskId);
    pushed(harness, taskId);

    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId).stage).toBe('awaiting_merge');
    approve(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('merging');
    expect(harness.lastEffect('pull_request.merge').taskId).toBe(taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(harness.task(taskId).stage).toBe('merged');
    expect(harness.lastEffect('worktree.remove').taskId).toBe(taskId);
  });

  test('a pull request without CI reaches the merge gate', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'none' }) });
    expect(harness.openGate(taskId).kind).toBe('merge');
  });

  test('conflicts and unresolved comments are fixed too', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ mergeable: false, unresolvedComments: 2 }),
    });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain('2 unresolved review comments');
    expect(prompt).toContain('merge conflicts');
  });

  test('a pull request that keeps failing the same way stops after two fix rounds', () => {
    const { harness, taskId } = shipping();
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
      if (harness.task(taskId).stage !== 'fixing') break;
      pushFix(harness, taskId);
    }
    const gate = harness.openGate(taskId);
    expect(gate.purpose).toBe('failure');
    expect(gate.body).toBe(
      'The same problems came back after 2 fix rounds. Steer the agent in the chat, or retry.'
    );
  });

  test('a record that arrives while the fix is still being pushed is not judged', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    const rounds = harness.task(taskId).fixRounds;
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId)).toMatchObject({ stageReason: 'pushing the fix', fixRounds: rounds });
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).kind).toBe('merge');
  });

  test('a pull request that has not seen the pushed commit yet is not judged', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'new');
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'failing', headSha: 'old' }),
    });
    expect(harness.task(taskId).stageReason).toBe('waiting for GitHub to see the push');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ headSha: 'new' }) });
    expect(harness.openGate(taskId).kind).toBe('merge');
  });

  test('a sync while the merge runs does not open the merge gate again', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ mergeable: null }) });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_merge', stageReason: 'merging' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('a clean pull request clears a failure the loop left behind', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'gh' });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.kind)).toEqual(['merge']);
  });

  test('a closed pull request cancels the task, and later records are ignored', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'closed' }) });
    expect(harness.task(taskId).stage).toBe('cancelled');
    const events = harness.state.seq;
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    pushed(harness, taskId);
    expect(harness.state.seq).toBe(events);
  });

  test('a record for a task that is not shipping only stores the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'planning', pullRequest: { number: 42 } });
  });
});

describe('retrying a pull request step', () => {
  test('retrying a failed pull request open opens it again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not open the pull request', detail: 'auth' });
    const before = harness.effectsOf('pull_request.open').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.open')).toHaveLength(before + 1);
  });

  test('retrying a failed push pushes again instead of reading the stale pull request', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    harness.send({ type: 'effect.fail', taskId, title: 'Could not push the fixes', detail: 'rejected' });
    const before = harness.effectsOf('pull_request.push').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.push')).toHaveLength(before + 1);
  });

  test('retrying a failed merge checks the pull request again instead of pushing', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    approve(harness, taskId);
    harness.send({
      type: 'effect.fail',
      taskId,
      title: 'Could not merge the pull request',
      detail: 'blocked',
    });
    const pushes = harness.effectsOf('pull_request.push').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.push')).toHaveLength(pushes);
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'checking the pull request',
    });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).kind).toBe('merge');
  });

  test('retrying while the merge gate is open checks the pull request again', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'gh' });
    harness.send({ type: 'task.retry', taskId });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('shipping');
  });
});

describe('waiting on other tasks after building started', () => {
  test('a dependency added after building started only holds the merge gate', () => {
    const harness = createHarness();
    const base = createTask(harness, { intent: 'Base' });
    const top = createTask(harness, { intent: 'Top' });
    reachReviewGate(harness, top);
    harness.send({ type: 'task.block', taskId: top, blockedBy: [base] });
    expect(harness.task(top)).toMatchObject({ blockedBy: [base], stage: 'awaiting_review' });
    approve(harness, top);
    pushed(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest({ number: 2 }) });
    expect(harness.task(top).stageReason).toBe('waiting for “Base” to merge');
    expect(listOpenGates(harness.state, top)).toHaveLength(0);

    harness.send({
      type: 'pull_request.record',
      taskId: base,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(harness.effectsOf('pull_request.watch').map((effect) => effect.taskId)).toContain(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest({ number: 2 }) });
    expect(harness.task(top).stage).toBe('awaiting_merge');
  });

  test('a dependency added while the merge gate is open takes the gate back', () => {
    const harness = createHarness();
    const base = createTask(harness, { intent: 'Base' });
    const top = createTask(harness, { intent: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).kind).toBe('merge');
    harness.send({ type: 'task.block', taskId: top, blockedBy: [base] });
    expect(listOpenGates(harness.state, top)).toHaveLength(0);
    expect(harness.task(top)).toMatchObject({
      stage: 'shipping',
      stageReason: 'waiting for “Base” to merge',
    });
    harness.send({ type: 'task.block', taskId: top, blockedBy: [] });
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).kind).toBe('merge');
  });

  test('a dependency added while the merge runs leaves the merge alone', () => {
    const harness = createHarness();
    const base = createTask(harness, { intent: 'Base' });
    const top = createTask(harness, { intent: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    approve(harness, top);
    const watches = harness.effectsOf('pull_request.watch').length;
    harness.send({ type: 'task.block', taskId: top, blockedBy: [base] });
    expect(harness.task(top).stageReason).toBe('merging');
    expect(harness.effectsOf('pull_request.watch')).toHaveLength(watches);
  });

  test('cancelling the task it waits on lets its pull request be judged again', () => {
    const harness = createHarness();
    const base = createTask(harness, { intent: 'Base' });
    const top = createTask(harness, { intent: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'task.block', taskId: top, blockedBy: [base] });
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.task(top).stageReason).toBe('waiting for “Base” to merge');
    harness.send({ type: 'task.cancel', taskId: base });
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).kind).toBe('merge');
  });
});
