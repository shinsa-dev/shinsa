import { describe, expect, test } from 'bun:test';
import {
  type DomainError,
  type Gate,
  listOpenGates,
  type MergeStep,
  resolveMergeStepKey,
} from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  REPLY,
  reachReviewGate,
} from '../harness.ts';

const SECRET: MergeStep = {
  when: 'pre_merge',
  kind: 'secret',
  title: 'Set STRIPE_WEBHOOK_SECRET',
  detail: 'In the API service’s production environment.',
  command: null,
};

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return (error as DomainError).code;
  }
  throw new Error('expected a refusal');
}

function openGateOf(harness: Harness, taskId: string, type: Gate['type']) {
  return listOpenGates(harness.state, taskId).find((gate) => gate.type === type);
}

function answerReview(harness: Harness, taskId: string, answer: Record<string, unknown>) {
  const gate = openGateOf(harness, taskId, 'review');
  if (!gate) throw new Error('no open review gate');
  return harness.send({ type: 'gate.answer', gateId: gate.id, response: null, ...answer } as never);
}

function reachClean(harness: Harness, taskId: string) {
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
}

function listTexts(harness: Harness, taskId: string) {
  return harness.task(taskId).activity.map((entry) => entry.text);
}

function reachReviewWithSteps(harness: Harness, taskId: string) {
  proposePlan(harness, taskId);
  completePhase(harness, taskId);
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Wired the webhook.',
    spots: [],
    judgementCalls: [],
    walkthrough: {
      approach: 'Verify, then record.',
      flow: 'webhook → verify → store',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [SECRET],
    },
  });
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings: { confidence: 'high', risk: 'low' },
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
}

describe('Approve and merge', () => {
  test('approves the review, then merges the clean pull request without opening a merge gate for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve', thenMerge: true });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', mergeAhead: true });
    reachClean(harness, taskId);
    const merge = harness.state.gates[Object.keys(harness.state.gates).at(-1) ?? ''];
    expect(merge).toMatchObject({ type: 'merge', status: 'answered', decision: 'approve' });
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(1);
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_merge', mergeAhead: false });
    expect(listTexts(harness, taskId)).toEqual(
      expect.arrayContaining([
        'Approved, to merge once ready: Fix tab group scroll',
        'Merged once ready, as you asked: Fix tab group scroll',
      ])
    );
  });

  test('a plain approve still waits for you at the merge gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve' });
    reachClean(harness, taskId);
    expect(openGateOf(harness, taskId, 'merge')).toBeDefined();
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
    expect(harness.task(taskId).mergeAhead ?? false).toBe(false);
  });

  test('fix, then approve and merge fixes, ships and merges without asking again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    answerReview(harness, taskId, {
      decision: 'revise',
      response: 'Rename the helper.',
      thenApprove: true,
      thenMerge: true,
    });
    expect(listTexts(harness, taskId)).toContain(
      'Asked for changes, then to approve and merge once ready: Fix tab group scroll'
    );
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Renamed it.',
      reply: REPLY,
    });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      ratings: { confidence: 'high', risk: 'low' },
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', mergeAhead: true });
    reachClean(harness, taskId);
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(1);
    expect(openGateOf(harness, taskId, 'merge')).toBeUndefined();
  });

  test('a pre-merge step holds the merge gate open until you tick it, and the tick merges', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewWithSteps(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve', thenMerge: true });
    reachClean(harness, taskId);
    expect(openGateOf(harness, taskId, 'merge')).toBeDefined();
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
    harness.send({ type: 'merge_step.tick', taskId, key: resolveMergeStepKey(SECRET), done: false });
    expect(openGateOf(harness, taskId, 'merge')).toBeDefined();
    harness.send({ type: 'merge_step.tick', taskId, key: resolveMergeStepKey(SECRET), done: true });
    expect(openGateOf(harness, taskId, 'merge')).toBeUndefined();
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(1);
  });

  test('a tick without Approve and merge leaves the merge gate for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewWithSteps(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve' });
    reachClean(harness, taskId);
    harness.send({ type: 'merge_step.tick', taskId, key: resolveMergeStepKey(SECRET), done: true });
    expect(openGateOf(harness, taskId, 'merge')).toBeDefined();
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
  });

  test('is refused anywhere but approving a review or asking to approve after the fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve' });
    reachClean(harness, taskId);
    const merge = openGateOf(harness, taskId, 'merge');
    expect(
      refusal(() =>
        harness.send({
          type: 'gate.answer',
          gateId: merge?.id ?? '',
          decision: 'approve',
          response: null,
          thenMerge: true,
        })
      )
    ).toBe('then_merge_invalid');
    const other = createTask(harness);
    reachReviewGate(harness, other);
    expect(refusal(() => answerReview(harness, other, { decision: 'reject', thenMerge: true }))).toBe(
      'then_merge_conflict'
    );
    expect(
      refusal(() => answerReview(harness, other, { decision: 'revise', response: 'Again.', thenMerge: true }))
    ).toBe('then_merge_conflict');
  });
});

describe('Keep the merge gate', () => {
  test('turns Approve and merge off, so the merge gate waits for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    answerReview(harness, taskId, { decision: 'approve', thenMerge: true });
    harness.send({ type: 'task.keep_merge_gate', taskId });
    expect(harness.task(taskId).mergeAhead).toBe(false);
    expect(listTexts(harness, taskId)).toContain(
      'Kept the merge gate: the pull request waits for you to merge it'
    );
    reachClean(harness, taskId);
    expect(openGateOf(harness, taskId, 'merge')).toBeDefined();
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
  });

  test('is refused for an agent, with nothing to keep, and on a finished task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(refusal(() => harness.send({ type: 'task.keep_merge_gate', taskId }))).toBe('merge_gate_kept');
    answerReview(harness, taskId, { decision: 'approve', thenMerge: true });
    expect(refusal(() => harness.send({ type: 'task.keep_merge_gate', taskId }, { onBehalf: true }))).toBe(
      'human_only'
    );
    harness.send({ type: 'task.cancel', taskId });
    expect(refusal(() => harness.send({ type: 'task.keep_merge_gate', taskId }))).toBe('task_settled');
  });
});
