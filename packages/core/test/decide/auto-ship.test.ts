import { describe, expect, test } from 'bun:test';
import type { AutoShipPolicy, ReviewFinding, ReviewRatings, TaskPriority } from '../../src/index.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import {
  buildAll,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  pullRequest,
  pushed,
  resolveReply,
} from '../harness.ts';

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

const SHOULD_FIX: ReviewFinding = { severity: 'should_fix', file: 'b.ts', line: 7, message: 'Name it.' };

const BLOCKING: ReviewFinding = { severity: 'blocking', file: 'a.ts', line: 3, message: 'This breaks.' };

function setup(policy: Partial<AutoShipPolicy> | null, priority: TaskPriority = 'normal') {
  const harness = createHarness();
  if (policy) harness.send({ type: 'settings.change', patch: { autoShip: { enabled: true, ...policy } } });
  const taskId = createTask(harness, { priority });
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  return { harness, taskId };
}

function review(harness: Harness, taskId: string, ratings = HIGH_LOW, findings: ReviewFinding[] = []) {
  harness.send({
    type: 'agent.report_review',
    ratings,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings,
  });
}

function fix(harness: Harness, taskId: string, treeHash: string) {
  const runId = harness.activeRun(taskId).id;
  harness.send({
    type: 'agent.complete_fix',
    runId,
    summary: 'Fixed.',
    treeHash,
    ...resolveReply(harness, runId),
  });
  harness.send({ type: 'checks.record', taskId, results: PASSING });
}

function reviewGate(harness: Harness, taskId: string) {
  return Object.values(harness.state.gates).find((gate) => gate.taskId === taskId && gate.type === 'review');
}

function expectWaitsForYou(harness: Harness, taskId: string, held: string | null) {
  expect(harness.openGate(taskId)).toMatchObject({ type: 'review', status: 'open' });
  expect(harness.openGate(taskId).autoShipHeld ?? null).toBe(held);
  expect(harness.task(taskId).stage).toBe('awaiting_review');
  expect(harness.task(taskId).autoShipped ?? null).toBeNull();
}

describe('Auto-ship at the review', () => {
  test('is off by default, so a high-confidence, low-risk review still waits for you', () => {
    const { harness, taskId } = setup(null);
    review(harness, taskId);
    expectWaitsForYou(harness, taskId, null);
  });

  test('approves a high-confidence, low-risk change for you and says why', () => {
    const { harness, taskId } = setup({});
    review(harness, taskId);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(reviewGate(harness, taskId)).toMatchObject({ status: 'answered', decision: 'approve' });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      autoShipped: { at: harness.state.tasks[taskId]?.autoShipped?.at, reason: 'High confidence, low risk.' },
    });
    const entry = harness.task(taskId).activity.find((found) => found.text.startsWith('Approved for you'));
    expect(entry).toMatchObject({
      actor: 'shinsa',
      kind: 'decision',
      text: `Approved for you by Auto-ship: ${harness.task(taskId).title}`,
      detail: 'High confidence, low risk.',
    });
  });

  test.each([
    ['medium confidence', { confidence: 'medium', risk: 'low' }, 'The reviewer’s confidence is medium.'],
    ['low confidence', { confidence: 'low', risk: 'low' }, 'The reviewer’s confidence is low.'],
    [
      'a risk above the limit',
      { confidence: 'high', risk: 'medium' },
      'The risk is medium, above what Auto-ship approves.',
    ],
  ] as const)('leaves a review with %s for you, and says why', (_case, ratings, held) => {
    const { harness, taskId } = setup({});
    review(harness, taskId, ratings);
    expectWaitsForYou(harness, taskId, held);
  });

  test('approves nothing that is not urgent when its limit is none', () => {
    const { harness, taskId } = setup({ approveUpTo: 'none' });
    review(harness, taskId);
    expectWaitsForYou(harness, taskId, 'The risk is low, above what Auto-ship approves.');
  });

  test('approves an urgent change up to the urgent limit, and says it was urgent', () => {
    const { harness, taskId } = setup({ approveUpTo: 'none', urgentApproveUpTo: 'medium' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      autoShipped: { reason: 'High confidence, medium risk, urgent.' },
    });
  });

  test('leaves an urgent change above the urgent limit for you', () => {
    const { harness, taskId } = setup({ urgentApproveUpTo: 'medium' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'high' });
    expectWaitsForYou(harness, taskId, 'The risk is high, above what Auto-ship approves.');
  });

  test('has the agents fix what the reviewer says should be fixed, then approves', () => {
    const { harness, taskId } = setup({});
    review(harness, taskId, HIGH_LOW, [SHOULD_FIX]);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, HIGH_LOW, [{ ...SHOULD_FIX, severity: 'optional' }]);
    expect(harness.task(taskId).stage).toBe('shipping');
  });

  test('a suggestion on a change it would not approve still goes to you, unfixed', () => {
    const { harness, taskId } = setup({});
    review(harness, taskId, { confidence: 'medium', risk: 'low' }, [SHOULD_FIX]);
    expectWaitsForYou(harness, taskId, 'The reviewer’s confidence is medium.');
  });

  test('a review the agents could not settle always waits for you', () => {
    const { harness, taskId } = setup({});
    review(harness, taskId, HIGH_LOW, [BLOCKING]);
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, HIGH_LOW, [BLOCKING]);
    fix(harness, taskId, 'tree-1');
    expect(harness.openGate(taskId).escalation?.reason).toBe('stalled');
    expectWaitsForYou(harness, taskId, 'The agents could not settle the review.');
  });

  test('a review that opens again forgets the earlier approval', () => {
    const { harness, taskId } = setup({});
    review(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({ type: 'settings.change', patch: { autoShip: { enabled: false } } });
    const merge = harness.openGate(taskId);
    expect(merge.type).toBe('merge');
    harness.send({ type: 'gate.answer', gateId: merge.id, decision: 'revise', response: 'Rename it.' });
    fix(harness, taskId, 'tree-2');
    review(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('review');
    expect(harness.task(taskId).autoShipped).toBeNull();
  });
});

describe('the Auto-ship setting', () => {
  test('a change keeps what it leaves out', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autoShip: { enabled: true, urgentWaitMinutes: 30 } } });
    harness.send({ type: 'settings.change', patch: { autoShip: { merge: 'approved' } } });
    expect(harness.state.settings.autoShip).toEqual({
      enabled: true,
      approveUpTo: 'low',
      urgentApproveUpTo: 'medium',
      merge: 'approved',
      urgent: 'escalate',
      urgentWaitMinutes: 30,
    });
  });

  test.each([0, 1441, 2.5])('refuses an urgent wait of %p minutes', (minutes) => {
    const harness = createHarness();
    expect(() =>
      harness.send({ type: 'settings.change', patch: { autoShip: { urgentWaitMinutes: minutes } } })
    ).toThrow('An urgent change waits 1 to 1440 minutes.');
  });
});
