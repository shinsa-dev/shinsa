import { describe, expect, test } from 'bun:test';
import { resolveEscalationHandoff } from '../../src/decide/autopilot.ts';
import {
  type AutopilotPolicy,
  type AutopilotContact,
  HOUR_MS,
  type MergeStep,
  MINUTE_MS,
  type ReviewFinding,
  type ReviewRatings,
  type TaskPriority,
} from '../../src/index.ts';
import { applyEvent } from '../../src/state/project.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import {
  approve,
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  resolveReply,
} from '../harness.ts';

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

const SHOULD_FIX: ReviewFinding = { severity: 'should_fix', file: 'b.ts', line: 7, message: 'Name it.' };

const BLOCKING: ReviewFinding = { severity: 'blocking', file: 'a.ts', line: 3, message: 'This breaks.' };

function setup(policy: Partial<AutopilotPolicy> | null, priority: TaskPriority = 'normal') {
  const harness = createHarness();
  if (policy) harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, ...policy } } });
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
  expect(harness.openGate(taskId).autopilotHeld ?? null).toBe(held);
  expect(harness.task(taskId).stage).toBe('awaiting_review');
  expect(harness.task(taskId).autopiloted ?? null).toBeNull();
}

describe('Autopilot at the review', () => {
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
      autopiloted: { at: harness.state.tasks[taskId]?.autopiloted?.at, reason: 'High confidence, low risk.' },
    });
    const entry = harness.task(taskId).activity.find((found) => found.text.startsWith('Approved for you'));
    expect(entry).toMatchObject({
      actor: 'shinsa',
      kind: 'decision',
      text: `Approved for you by Autopilot: ${harness.task(taskId).title}`,
      detail: 'High confidence, low risk.',
    });
  });

  test.each([
    ['medium confidence', { confidence: 'medium', risk: 'low' }, 'The reviewer’s confidence is medium.'],
    ['low confidence', { confidence: 'low', risk: 'low' }, 'The reviewer’s confidence is low.'],
    [
      'a risk above the limit',
      { confidence: 'high', risk: 'medium' },
      'The risk is medium, above what Autopilot approves.',
    ],
  ] as const)('leaves a review with %s for you, and says why', (_case, ratings, held) => {
    const { harness, taskId } = setup({});
    review(harness, taskId, ratings);
    expectWaitsForYou(harness, taskId, held);
  });

  test('approves nothing that is not urgent when its limit is none', () => {
    const { harness, taskId } = setup({ approveUpTo: 'none' });
    review(harness, taskId);
    expectWaitsForYou(harness, taskId, 'The risk is low, above what Autopilot approves.');
  });

  test('approves an urgent change up to the urgent limit, and says it was urgent', () => {
    const { harness, taskId } = setup({ approveUpTo: 'none', urgentApproveUpTo: 'medium' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      autopiloted: { reason: 'High confidence, medium risk, urgent.' },
    });
  });

  test('does not count urgency an agent set on your behalf', () => {
    const { harness, taskId } = setup({ approveUpTo: 'none', urgentApproveUpTo: 'medium' });
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' }, { onBehalf: true });
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    expectWaitsForYou(harness, taskId, 'The risk is medium, above what Autopilot approves.');
  });

  test('leaves an urgent change above the urgent limit for you', () => {
    const { harness, taskId } = setup({ urgentApproveUpTo: 'medium' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'high' });
    expectWaitsForYou(harness, taskId, 'The risk is high, above what Autopilot approves.');
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
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: false } } });
    const merge = harness.openGate(taskId);
    expect(merge.type).toBe('merge');
    harness.send({ type: 'gate.answer', gateId: merge.id, decision: 'revise', response: 'Rename it.' });
    fix(harness, taskId, 'tree-2');
    review(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('review');
    expect(harness.task(taskId).autopiloted).toBeNull();
  });
});

describe('the Autopilot setting', () => {
  test('a change keeps what it leaves out', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, urgentWaitMinutes: 30 } } });
    harness.send({ type: 'settings.change', patch: { autopilot: { merge: 'approved' } } });
    expect(harness.state.settings.autopilot).toEqual({
      enabled: true,
      approveUpTo: 'low',
      urgentApproveUpTo: 'medium',
      merge: 'approved',
      urgent: 'escalate',
      urgentWaitMinutes: 30,
      ignoreUsageLimits: true,
      contacts: [],
    });
  });

  test.each([0, 1441, 2.5])('refuses an urgent wait of %p minutes', (minutes) => {
    const harness = createHarness();
    expect(() =>
      harness.send({ type: 'settings.change', patch: { autopilot: { urgentWaitMinutes: minutes } } })
    ).toThrow('An urgent change waits 1 to 1440 minutes.');
  });
});

const SECRET: MergeStep = {
  when: 'pre_merge',
  kind: 'secret',
  title: 'Set STRIPE_WEBHOOK_SECRET',
  detail: 'In production.',
  command: null,
};

const WAIT = 60 * MINUTE_MS;

const WAITED = 'Urgent, and the merge waited 60 minutes for you.';

const READY = 'Urgent, and ready to merge.';

function handOverWithSteps(harness: Harness, taskId: string, steps: MergeStep[]) {
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
      steps,
    },
  });
}

interface MergeSetup {
  policy: Partial<AutopilotPolicy>;
  priority?: TaskPriority;
  ratings?: ReviewRatings;
  steps?: MergeStep[];
}

function reachMerge({ policy, priority = 'normal', ratings = HIGH_LOW, steps }: MergeSetup) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, ...policy } } });
  const taskId = createTask(harness, { priority });
  if (steps) handOverWithSteps(harness, taskId, steps);
  else buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  review(harness, taskId, ratings);
  if (harness.task(taskId).stage === 'awaiting_review') approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
  return { harness, taskId };
}

function mergeGate(harness: Harness, taskId: string) {
  return Object.values(harness.state.gates)
    .filter((gate) => gate.taskId === taskId && gate.type === 'merge')
    .at(-1);
}

function expectMerging(harness: Harness, taskId: string, reason: string) {
  expect(mergeGate(harness, taskId)).toMatchObject({ status: 'answered', decision: 'approve' });
  expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_merge', stageReason: 'merging' });
  expect(harness.lastEffect('pull_request.merge')).toMatchObject({ taskId });
  const entry = harness
    .task(taskId)
    .activity.filter((found) => found.text.startsWith('Approved the merge'))
    .at(-1);
  expect(entry).toMatchObject({
    actor: 'shinsa',
    text: `Approved the merge for you by Autopilot: ${harness.task(taskId).title}`,
    detail: reason,
  });
}

function expectMergeWaits(harness: Harness, taskId: string) {
  expect(harness.openGate(taskId)).toMatchObject({ type: 'merge', status: 'open' });
  expect(harness.task(taskId).stage).toBe('awaiting_merge');
  expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
}

function fire(harness: Harness, taskId: string, dueAt = mergeGate(harness, taskId)?.autopilotDue?.at ?? 0) {
  harness.advance(Math.max(0, dueAt - harness.now));
  return harness.send({
    type: 'autopilot.fire',
    taskId,
    gateId: mergeGate(harness, taskId)?.id ?? '',
    dueAt,
  });
}

describe('Autopilot at the merge', () => {
  test('never merges by default, and sets no deadline on a change that is not urgent', () => {
    const { harness, taskId } = reachMerge({ policy: {} });
    expectMergeWaits(harness, taskId);
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
  });

  test('merges a change it approved as soon as the pull request is clean', () => {
    const { harness, taskId } = reachMerge({ policy: { merge: 'approved', approveUpTo: 'medium' } });
    expectMerging(harness, taskId, 'High confidence, low risk.');
    expect(harness.task(taskId).autopiloted?.reason).toBe('High confidence, low risk.');
  });

  test('with the low-risk rule, merges a low-risk change and leaves a medium-risk one for you', () => {
    const low = reachMerge({ policy: { merge: 'low_risk' } });
    expectMerging(low.harness, low.taskId, 'High confidence, low risk.');
    const medium = reachMerge({
      policy: { merge: 'low_risk', approveUpTo: 'medium' },
      ratings: { confidence: 'high', risk: 'medium' },
    });
    expectMergeWaits(medium.harness, medium.taskId);
  });

  test('never merges a change whose review you approved yourself', () => {
    const { harness, taskId } = reachMerge({
      policy: { merge: 'approved' },
      ratings: { confidence: 'medium', risk: 'low' },
    });
    expectMergeWaits(harness, taskId);
  });

  test('never merges while a pre-merge step is not ticked', () => {
    const { harness, taskId } = reachMerge({ policy: { merge: 'approved' }, steps: [SECRET] });
    expectMergeWaits(harness, taskId);
  });

  test.each(['wait', 'escalate'] as const)(
    'sets no deadline on an urgent change when the urgent rule is %s, or Autopilot is off',
    (urgent) => {
      const { harness, taskId } = reachMerge({ policy: { urgent }, priority: 'urgent' });
      expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
      harness.send({ type: 'settings.change', patch: { autopilot: { enabled: false } } });
      answerMerge(harness, taskId);
      fix(harness, taskId, 'tree-2');
      review(harness, taskId);
      approve(harness, taskId);
      pushed(harness, taskId);
      harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
      expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
      expect(harness.task(taskId).escalation ?? null).toBeNull();
    }
  );

  test('asks for a review as soon as an urgent merge opens, once, and clears it when the merge is answered', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'escalate' }, priority: 'urgent' });
    const hours = Object.keys(harness.state.presence).map(Number);
    expect(harness.task(taskId).escalation).toEqual({
      at: harness.now,
      reason: READY,
      handoff: {
        waitedMinutes: 0,
        ownerActiveAt: Math.max(...hours) * HOUR_MS,
        foundBy: null,
        ratings: HIGH_LOW,
        mergesAt: null,
        blockedBy: null,
      },
    });
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Escalated by Autopilot',
      detail: READY,
    });
    const before = harness.task(taskId).escalation;
    harness.send({ type: 'settings.change', patch: { autopilot: { urgentWaitMinutes: 30 } } });
    expect(harness.task(taskId).escalation).toEqual(before);
    expect(harness.effectsOf('pull_request.merge')).toHaveLength(0);
    approve(harness, taskId);
    expect(harness.task(taskId).escalation).toBeNull();
  });

  test('merges an urgent change it approved once the merge waited, without asking anyone', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation ?? null).toBeNull();
    expect(harness.openGate(taskId).autopilotDue?.action).toBe('merge');
    fire(harness, taskId);
    expectMerging(harness, taskId, WAITED);
  });

  test('escalates instead of merging an urgent change whose review you approved', () => {
    const { harness, taskId } = reachMerge({
      policy: { urgent: 'merge' },
      priority: 'urgent',
      ratings: { confidence: 'medium', risk: 'low' },
    });
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation?.reason).toBe(`${WAITED} You approved the review yourself.`);
    expect(harness.task(taskId).escalation?.handoff.blockedBy).toBe('self_approved');
    expect(harness.openGate(taskId).autopilotDue).toBeNull();
  });

  test('escalates instead of merging an urgent change with a pre-merge step left', () => {
    const { harness, taskId } = reachMerge({
      policy: { urgent: 'merge' },
      priority: 'urgent',
      steps: [SECRET],
    });
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation?.reason).toBe(`${WAITED} A pre-merge step is not ticked yet.`);
  });

  test('asks for a review at once, then merges after the wait', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'escalate_then_merge' }, priority: 'urgent' });
    expect(harness.task(taskId).escalation?.reason).toBe(READY);
    expect(harness.openGate(taskId).autopilotDue).toEqual({ at: harness.now + WAIT, action: 'merge' });
    expect(harness.task(taskId).escalation?.handoff.mergesAt).toBe(harness.now + WAIT);
    fire(harness, taskId);
    expectMerging(harness, taskId, WAITED);
    expect(harness.task(taskId).escalation).toBeNull();
  });

  test('asks at once and says why when it would not merge the change after the wait', () => {
    const { harness, taskId } = reachMerge({
      policy: { urgent: 'escalate_then_merge' },
      priority: 'urgent',
      ratings: { confidence: 'medium', risk: 'low' },
    });
    expect(harness.task(taskId).escalation?.reason).toBe(`${READY} You approved the review yourself.`);
    expect(harness.task(taskId).escalation?.handoff).toMatchObject({
      mergesAt: null,
      blockedBy: 'self_approved',
    });
    const before = harness.task(taskId).escalation;
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation).toEqual(before);
    expect(harness.openGate(taskId).autopilotDue).toBeNull();
  });

  test('stops promising a merge when the wait ends on something that refuses it', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'escalate_then_merge' }, priority: 'urgent' });
    const escalatedAt = harness.task(taskId).escalation?.at;
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation).toMatchObject({
      at: escalatedAt,
      reason: `${WAITED} Your edits are not pushed yet.`,
      handoff: { mergesAt: null, blockedBy: 'edits_not_pushed', waitedMinutes: 60 },
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Autopilot could not merge it',
      detail: `${WAITED} Your edits are not pushed yet.`,
    });
    expect(harness.openGate(taskId).autopilotDue).toBeNull();
  });

  test('does nothing but clear the deadline once Autopilot is off or the task is no longer urgent', () => {
    const off = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
    const dueAt = off.harness.openGate(off.taskId).autopilotDue?.at ?? 0;
    off.harness.send({ type: 'settings.change', patch: { autopilot: { enabled: false } } });
    fire(off.harness, off.taskId, dueAt);
    expectMergeWaits(off.harness, off.taskId);
    expect(off.harness.openGate(off.taskId).autopilotDue).toBeNull();
    expect(off.harness.task(off.taskId).escalation ?? null).toBeNull();
    const calm = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
    const calmDue = calm.harness.openGate(calm.taskId).autopilotDue?.at ?? 0;
    calm.harness.send({ type: 'task.prioritize', taskId: calm.taskId, priority: 'normal' });
    fire(calm.harness, calm.taskId, calmDue);
    expectMergeWaits(calm.harness, calm.taskId);
  });

  test.each(['wait', 'escalate'] as const)(
    'merges nothing when you switch to %s after the deadline was set',
    (urgent) => {
      const { harness, taskId } = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
      const dueAt = harness.openGate(taskId).autopilotDue?.at ?? 0;
      harness.send({ type: 'settings.change', patch: { autopilot: { urgent } } });
      expect(harness.task(taskId).escalation ? 'escalate' : 'wait').toBe(urgent);
      fire(harness, taskId, dueAt);
      expectMergeWaits(harness, taskId);
      expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
    }
  );

  test('keeps the deadline and merges when you switch from merging to asking, then merging', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
    const dueAt = harness.openGate(taskId).autopilotDue?.at ?? 0;
    harness.send({ type: 'settings.change', patch: { autopilot: { urgent: 'escalate_then_merge' } } });
    expect(harness.openGate(taskId).autopilotDue?.at).toBe(dueAt);
    expect(harness.task(taskId).escalation?.handoff.mergesAt).toBe(dueAt);
    fire(harness, taskId, dueAt);
    expectMerging(harness, taskId, WAITED);
  });

  test('asks at once when the task turns urgent while its merge waits, and drops the deadline when it calms', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'escalate_then_merge' } });
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
    expect(harness.task(taskId).escalation ?? null).toBeNull();
    harness.advance(5 * MINUTE_MS);
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    expect(harness.openGate(taskId).autopilotDue).toEqual({ at: harness.now + WAIT, action: 'merge' });
    expect(harness.task(taskId).escalation?.reason).toBe(READY);
    harness.send({ type: 'task.prioritize', taskId, priority: 'normal' });
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
  });

  test('asks at once when you turn asking on while an urgent merge waits', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'wait' }, priority: 'urgent' });
    expect(harness.task(taskId).escalation ?? null).toBeNull();
    harness.send({ type: 'settings.change', patch: { autopilot: { urgent: 'escalate' } } });
    expect(harness.task(taskId).escalation?.reason).toBe(READY);
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
  });

  test('ignores a fire for a gate that closed, another task or nothing it knows', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'merge' }, priority: 'urgent' });
    const gate = harness.openGate(taskId);
    const dueAt = gate.autopilotDue?.at ?? 0;
    expect(harness.send({ type: 'autopilot.fire', taskId: 'gone', gateId: gate.id, dueAt }).events).toEqual(
      []
    );
    expect(harness.send({ type: 'autopilot.fire', taskId, gateId: 'gone', dueAt }).events).toEqual([]);
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'revise', response: 'Rename it.' });
    expect(harness.send({ type: 'autopilot.fire', taskId, gateId: gate.id, dueAt }).events).toEqual([]);
  });

  test('an escalated change that is sent back is no longer escalated', () => {
    const { harness, taskId } = reachMerge({ policy: { urgent: 'escalate' }, priority: 'urgent' });
    answerMerge(harness, taskId);
    expect(harness.task(taskId).escalation).toBeNull();
  });
});

describe('the hand-off an escalation carries', () => {
  test('names the watchdog that found it and the change it shipped, and no activity when there is none', () => {
    const harness = createHarness();
    const shippedId = createTask(harness);
    const fixId = createTask(harness);
    const forked = {
      ...harness.task(fixId),
      createdBy: { kind: 'watchdog' as const, taskId: shippedId, runId: 'run-1', requestKey: 'k' },
      sourceReport: {
        scheduleId: null,
        watchdogId: 'w-1',
        server: 'cloudflare',
        reportId: null,
        link: null,
        author: null,
        postedAt: null,
        text: '500s',
      },
    };
    const state = { ...harness.state, presence: {} };
    expect(
      resolveEscalationHandoff(state, forked, { waitedMinutes: 15, mergesAt: 9_000, blockedBy: null })
    ).toEqual({
      waitedMinutes: 15,
      ownerActiveAt: null,
      foundBy: { server: 'cloudflare', shippedTaskTitle: harness.task(shippedId).title },
      ratings: null,
      mergesAt: 9_000,
      blockedBy: null,
    });
    const orphan = { ...forked, createdBy: { ...forked.createdBy, taskId: 'gone' }, sourceReport: null };
    expect(
      resolveEscalationHandoff(state, orphan, { waitedMinutes: 15, mergesAt: null, blockedBy: null }).foundBy
    ).toEqual({
      server: null,
      shippedTaskTitle: null,
    });
  });
});

const ONCALL: AutopilotContact = { kind: 'slack_channel', teamId: 'T1', id: 'C9', name: 'oncall' };

const KAI: AutopilotContact = { kind: 'slack_person', teamId: 'T1', id: 'U7', name: 'Kai Tanaka' };

function escalateTo(...contacts: AutopilotContact[]) {
  const policy: Partial<AutopilotPolicy> = { urgent: 'escalate', contacts };
  const { harness, taskId } = reachMerge({ policy, priority: 'urgent' });
  return { harness, taskId, escalatedAt: harness.task(taskId).escalation?.at ?? 0 };
}

function recordSent(
  harness: Harness,
  taskId: string,
  escalatedAt: number,
  problem: string | null = null,
  contact: AutopilotContact = ONCALL
) {
  return harness.send({
    type: 'slack.record_escalation',
    taskId,
    escalatedAt,
    contact,
    channelId: problem === null ? contact.id : null,
    ts: problem === null ? '500.1' : null,
    problem,
  });
}

function answerMerge(harness: Harness, taskId: string) {
  harness.send({
    type: 'gate.answer',
    gateId: harness.openGate(taskId).id,
    decision: 'revise',
    response: 'x',
  });
}

describe('the escalation contacts', () => {
  test('keeps the Slack channels and people you choose, and clears them back to your team alone', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autopilot: { contacts: [ONCALL, KAI] } } });
    expect(harness.state.settings.autopilot?.contacts).toEqual([ONCALL, KAI]);
    harness.send({ type: 'settings.change', patch: { autopilot: { contacts: [] } } });
    expect(harness.state.settings.autopilot?.contacts).toEqual([]);
  });

  test('refuses the same channel or person twice', () => {
    const harness = createHarness();
    expect(() =>
      harness.send({
        type: 'settings.change',
        patch: { autopilot: { contacts: [ONCALL, KAI, { ...ONCALL, name: 'renamed' }] } },
      })
    ).toThrow('Each Slack channel or person is listed once.');
  });
});

describe('escalating to Slack', () => {
  test('sends nothing to Slack by default, so only your team sees the escalation', () => {
    const { harness, taskId } = escalateTo();
    expect(harness.task(taskId).escalation?.reason).toBe(READY);
    expect(harness.effectsOf('slack.escalate')).toHaveLength(0);
  });

  test.each([ONCALL, KAI])('asks Slack to tell $name, beside the team escalation', (contact) => {
    const { harness, taskId, escalatedAt } = escalateTo(contact);
    expect(harness.task(taskId).escalation?.at).toBe(escalatedAt);
    expect(harness.effectsOf('slack.escalate')).toEqual([
      { kind: 'slack.escalate', taskId, escalatedAt, contact, part: 'message' },
    ]);
  });

  test('tells every contact at once, a channel and a person both', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL, KAI);
    expect(harness.effectsOf('slack.escalate')).toEqual([
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: KAI, part: 'message' },
    ]);
  });

  test('records where it went once per contact, in the task’s activity', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL, KAI);
    recordSent(harness, taskId, escalatedAt);
    recordSent(harness, taskId, escalatedAt, null, KAI);
    expect(harness.task(taskId).slackEscalations).toEqual([
      { escalatedAt, contact: ONCALL, channelId: ONCALL.id, ts: '500.1', followUpTs: null },
      { escalatedAt, contact: KAI, channelId: KAI.id, ts: '500.1', followUpTs: null },
    ]);
    expect(harness.task(taskId).activity.at(-2)).toMatchObject({
      actor: 'shinsa',
      text: 'Sent to #oncall in Slack',
      detail: null,
    });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Sent to Kai Tanaka in Slack');
    expect(recordSent(harness, taskId, escalatedAt).events).toEqual([]);
    expect(harness.send({ ...recordCommand(taskId, escalatedAt), taskId: 'gone' }).events).toEqual([]);
  });

  test('forgets the posts of an earlier escalation when a new one is sent', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL);
    recordSent(harness, taskId, escalatedAt - 1);
    recordSent(harness, taskId, escalatedAt);
    expect(harness.task(taskId).slackEscalations?.map((post) => post.escalatedAt)).toEqual([escalatedAt]);
  });

  test('says when Slack could not be reached, with Slack’s reason', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL);
    recordSent(harness, taskId, escalatedAt, 'The Shinsa app is not in #oncall.');
    expect(harness.task(taskId).slackEscalations?.[0]?.ts).toBeNull();
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      text: 'Could not reach #oncall in Slack',
      detail: 'The Shinsa app is not in #oncall.',
    });
  });

  test('edits every Slack message once the escalation clears, with the contacts it went to', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL, KAI);
    recordSent(harness, taskId, escalatedAt);
    recordSent(harness, taskId, escalatedAt, null, KAI);
    harness.send({ type: 'settings.change', patch: { autopilot: { contacts: [] } } });
    answerMerge(harness, taskId);
    expect(harness.task(taskId).escalation).toBeNull();
    expect(harness.effectsOf('slack.escalate')).toEqual([
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: KAI, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: KAI, part: 'message' },
    ]);
  });

  test('edits every Slack message when the wait ends without the merge it promised', () => {
    const policy: Partial<AutopilotPolicy> = { urgent: 'escalate_then_merge', contacts: [ONCALL] };
    const { harness, taskId } = reachMerge({ policy, priority: 'urgent' });
    const escalatedAt = harness.task(taskId).escalation?.at ?? 0;
    recordSent(harness, taskId, escalatedAt);
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    fire(harness, taskId);
    expect(harness.effectsOf('slack.escalate')).toEqual([
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
    ]);
  });

  test('revises nothing once the escalation it would revise is gone', () => {
    const harness = createHarness();
    const taskId = createTask(harness, {});
    const next = applyEvent(harness.state, {
      type: 'task.escalation_revised',
      taskId,
      reason: 'x',
      handoff: {
        waitedMinutes: 0,
        mergesAt: null,
        blockedBy: null,
        ownerActiveAt: null,
        foundBy: null,
        ratings: null,
      },
      seq: 1,
      at: 0,
    });
    expect(next.tasks[taskId]?.escalation ?? null).toBeNull();
  });

  test('edits nothing when the escalation never reached Slack, or another gate closes', () => {
    const { harness, taskId } = escalateTo(ONCALL);
    answerMerge(harness, taskId);
    expect(harness.effectsOf('slack.escalate')).toHaveLength(1);
    const other = escalateTo(ONCALL);
    recordSent(other.harness, other.taskId, other.escalatedAt);
    other.harness.send({ type: 'task.prioritize', taskId: other.taskId, priority: 'normal' });
    expect(other.harness.task(other.taskId).escalation?.at).toBe(other.escalatedAt);
    expect(other.harness.effectsOf('slack.escalate')).toHaveLength(1);
  });
});

describe('following up in Slack once it merges', () => {
  const sentAndMerged = () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL);
    recordSent(harness, taskId, escalatedAt);
    answerMerge(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    return { harness, taskId, escalatedAt };
  };

  test('marks the message merged and replies in its thread that it is still watched', () => {
    const { harness, taskId, escalatedAt } = sentAndMerged();
    expect(harness.effectsOf('slack.escalate').slice(-2)).toEqual([
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'message' },
      { kind: 'slack.escalate', taskId, escalatedAt, contact: ONCALL, part: 'follow_up' },
    ]);
  });

  test('records the reply in its thread once', () => {
    const { harness, taskId, escalatedAt } = sentAndMerged();
    const follow = {
      type: 'slack.record_escalation_follow_up' as const,
      taskId,
      escalatedAt,
      contact: ONCALL,
      ts: '600.1',
    };
    expect(harness.send(follow).events).toHaveLength(1);
    expect(harness.task(taskId).slackEscalations?.[0]?.followUpTs).toBe('600.1');
    expect(harness.send({ ...follow, ts: '600.2' }).events).toEqual([]);
    expect(harness.send({ ...follow, escalatedAt: 1 }).events).toEqual([]);
  });

  test('replies nowhere when the escalation never reached Slack or the change is not merged', () => {
    const { harness, taskId } = escalateTo(ONCALL);
    answerMerge(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(harness.effectsOf('slack.escalate').map((effect) => effect.part)).toEqual(['message']);
    const other = escalateTo(ONCALL);
    recordSent(other.harness, other.taskId, other.escalatedAt);
    other.harness.send({ type: 'pull_request.record', taskId: other.taskId, pullRequest: pullRequest() });
    expect(other.harness.effectsOf('slack.escalate').map((effect) => effect.part)).toEqual(['message']);
  });
});

function recordCommand(taskId: string, escalatedAt: number) {
  return {
    type: 'slack.record_escalation' as const,
    taskId,
    escalatedAt,
    contact: ONCALL,
    channelId: ONCALL.id,
    ts: '500.1',
    problem: null,
  };
}
