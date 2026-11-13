import { describe, expect, test } from 'bun:test';
import { resolveEscalationHandoff } from '../../src/decide/autopilot.ts';
import {
  AUTOPILOT_DEFAULTS,
  type AutopilotPolicy,
  type AutopilotContact,
  type MergeStep,
  MINUTE_MS,
  type ReviewFinding,
  type ReviewRatings,
  type TaskPriority,
} from '../../src/index.ts';
import { resolveQueue } from '../../src/queue/rank.ts';
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

function judgedGate(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).find((gate) => gate.autopilotJudging === true);
}

function judge(
  harness: Harness,
  taskId: string,
  reason: string,
  verdict: 'act' | 'forward' = 'act',
  reply: string | null = null
) {
  const gate = judgedGate(harness, taskId);
  if (!gate) throw new Error('No gate waits for Autopilot.');
  return harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gate.id,
    verdict,
    reason,
    reply,
    shadow: false,
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

function ABOVE(risk: string) {
  return `The risk is ${risk}, above what Autopilot does on its own.`;
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
    const { harness, taskId } = setup({ autoMerge: 'off' });
    review(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'review', autopilotJudging: true });
    expect(harness.lastEffect('autopilot.judge')).toMatchObject({ taskId });
    judge(harness, taskId, 'High confidence, low risk.');
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
    ['medium risk', { confidence: 'high', risk: 'medium' }, ABOVE('medium')],
  ] as const)('leaves a review with %s for you, and says why', (_case, ratings, held) => {
    const { harness, taskId } = setup({});
    review(harness, taskId, ratings);
    expectWaitsForYou(harness, taskId, held);
  });

  test('leaves every review for you when reviews are not among its gates', () => {
    const { harness, taskId } = setup({ gates: ['plans'] });
    review(harness, taskId);
    expectWaitsForYou(harness, taskId, 'Autopilot does not act on this kind of gate.');
  });

  test('approves a medium-risk change when it may do most things', () => {
    const { harness, taskId } = setup({ level: 'most', autoMerge: 'off' });
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    judge(harness, taskId, 'High confidence, medium risk.');
    expect(harness.task(taskId).autopiloted?.reason).toBe('High confidence, medium risk.');
  });

  test('asks you first about anything above low risk, even when urgent', () => {
    const { harness, taskId } = setup({ level: 'ask_first' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    expectWaitsForYou(harness, taskId, ABOVE('medium'));
  });

  test('approves an urgent change one risk higher, and says it was urgent', () => {
    const { harness, taskId } = setup({ autoMerge: 'off' }, 'urgent');
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    judge(harness, taskId, 'High confidence, medium risk, urgent.');
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      autopiloted: { reason: 'High confidence, medium risk, urgent.' },
    });
  });

  test('does not count urgency an agent set on your behalf', () => {
    const { harness, taskId } = setup({});
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' }, { onBehalf: true });
    review(harness, taskId, { confidence: 'high', risk: 'medium' });
    expectWaitsForYou(harness, taskId, ABOVE('medium'));
  });

  test('has the agents fix what the reviewer says should be fixed, then approves', () => {
    const { harness, taskId } = setup({ autoMerge: 'off' });
    review(harness, taskId, HIGH_LOW, [SHOULD_FIX]);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, HIGH_LOW, [{ ...SHOULD_FIX, severity: 'optional' }]);
    judge(harness, taskId, 'Fixed what the reviewer asked.');
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
    const { harness, taskId } = setup({ autoMerge: 'off' });
    review(harness, taskId);
    judge(harness, taskId, 'High confidence, low risk.');
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
  test('starts balanced, on plans, questions and reviews, with Auto merge for low risk', () => {
    expect(AUTOPILOT_DEFAULTS).toEqual({
      enabled: false,
      level: 'balanced',
      gates: ['plans', 'questions', 'reviews'],
      autoMerge: 'low_risk',
      escalate: true,
      ignoreUsageLimits: true,
      contacts: [],
    });
  });

  test('a change keeps what it leaves out', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, level: 'most' } } });
    harness.send({ type: 'settings.change', patch: { autopilot: { gates: ['reviews'], autoMerge: 'off' } } });
    expect(harness.state.settings.autopilot).toEqual({
      ...AUTOPILOT_DEFAULTS,
      enabled: true,
      level: 'most',
      gates: ['reviews'],
      autoMerge: 'off',
    });
  });

  test('refuses a gate named twice', () => {
    const harness = createHarness();
    expect(() =>
      harness.send({ type: 'settings.change', patch: { autopilot: { gates: ['plans', 'plans'] } } })
    ).toThrow('Name each Autopilot gate once.');
  });
});

const SECRET: MergeStep = {
  when: 'pre_merge',
  kind: 'secret',
  title: 'Set STRIPE_WEBHOOK_SECRET',
  detail: 'In production.',
  command: null,
};

const CHECK = 60 * MINUTE_MS;

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
  if (judgedGate(harness, taskId)) {
    const urgent = priority === 'urgent' ? ', urgent' : '';
    judge(harness, taskId, `High confidence, ${ratings.risk} risk${urgent}.`);
  }
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

function fireAway(harness: Harness, taskId: string) {
  fire(harness, taskId);
  fire(harness, taskId);
}

function waitedText(harness: Harness, taskId: string) {
  const gate = mergeGate(harness, taskId);
  const minutes = Math.floor((harness.now - (gate?.openedAt ?? 0)) / MINUTE_MS);
  return minutes < 60 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
}

const URGENT_HIGH: ReviewRatings = { confidence: 'high', risk: 'high' };

describe('Autopilot at the merge', () => {
  test('never merges with Auto merge off, and sets no deadline on a change that is not urgent', () => {
    const { harness, taskId } = reachMerge({ policy: { autoMerge: 'off' } });
    expectMergeWaits(harness, taskId);
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
  });

  test('merges a low-risk change it approved as soon as the pull request is clean', () => {
    const { harness, taskId } = reachMerge({ policy: {} });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'merge', autopilotJudging: true });
    judge(harness, taskId, 'High confidence, low risk.');
    expectMerging(harness, taskId, 'High confidence, low risk.');
  });

  test('merges a medium-risk change it approved only when Auto merge takes every approved change', () => {
    const ratings: ReviewRatings = { confidence: 'high', risk: 'medium' };
    const low = reachMerge({ policy: { level: 'most' }, ratings });
    expectMergeWaits(low.harness, low.taskId);
    const approved = reachMerge({ policy: { level: 'most', autoMerge: 'approved' }, ratings });
    judge(approved.harness, approved.taskId, 'High confidence, medium risk.');
    expectMerging(approved.harness, approved.taskId, 'High confidence, medium risk.');
  });

  test('never merges a change whose review you approved yourself', () => {
    const { harness, taskId } = reachMerge({
      policy: { autoMerge: 'approved' },
      ratings: { confidence: 'medium', risk: 'low' },
    });
    expectMergeWaits(harness, taskId);
  });

  test('never merges while a pre-merge step is not ticked', () => {
    const { harness, taskId } = reachMerge({ policy: {}, steps: [SECRET] });
    expectMergeWaits(harness, taskId);
  });

  test('checks an urgent change it may not merge yet again an hour later', () => {
    const { harness, taskId } = reachMerge({
      policy: {},
      priority: 'urgent',
      ratings: { confidence: 'high', risk: 'medium' },
    });
    expectMergeWaits(harness, taskId);
    expect(harness.openGate(taskId).autopilotDue).toEqual({ at: harness.now + CHECK });
  });

  test('merges an urgent medium-risk change once you have been away an hour, and says why', () => {
    const { harness, taskId } = reachMerge({
      policy: {},
      priority: 'urgent',
      ratings: { confidence: 'high', risk: 'medium' },
    });
    fireAway(harness, taskId);
    const reason = `Urgent, and you were away while the merge waited ${waitedText(harness, taskId)}.`;
    judge(harness, taskId, reason);
    expectMerging(harness, taskId, reason);
  });

  test('never merges or escalates while you are active, and checks again later', () => {
    const { harness, taskId } = reachMerge({
      policy: {},
      priority: 'urgent',
      ratings: { confidence: 'high', risk: 'medium' },
    });
    for (const _check of [1, 2, 3]) {
      harness.advance(CHECK - MINUTE_MS);
      createTask(harness);
      fire(harness, taskId);
    }
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation ?? null).toBeNull();
    expect(harness.openGate(taskId).autopilotDue).toEqual({ at: harness.now + CHECK });
  });

  test('sends an urgent high-risk change to your team once you have been away, never merging what you approved', () => {
    const { harness, taskId } = reachMerge({ policy: {}, priority: 'urgent', ratings: URGENT_HIGH });
    fire(harness, taskId);
    expect(harness.task(taskId).escalation ?? null).toBeNull();
    fire(harness, taskId);
    const reason = `Urgent, high risk, and you were away while the merge waited ${waitedText(harness, taskId)}.`;
    expect(harness.task(taskId).escalation).toMatchObject({
      reason: `${reason} You approved the review yourself.`,
      handoff: { mergesAt: null, blockedBy: 'self_approved', ratings: URGENT_HIGH },
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Escalated by Autopilot',
    });
    expectMergeWaits(harness, taskId);
  });

  test('does not contact your team when you turned that off', () => {
    const { harness, taskId } = reachMerge({
      policy: { escalate: false },
      priority: 'urgent',
      ratings: URGENT_HIGH,
    });
    fireAway(harness, taskId);
    expect(harness.task(taskId).escalation ?? null).toBeNull();
  });

  test('when it may do most things, tells your team first and merges an hour later if nobody acted', () => {
    const { harness, taskId } = reachMerge({
      policy: { level: 'most' },
      priority: 'urgent',
      ratings: URGENT_HIGH,
    });
    expect(harness.task(taskId).autopiloted?.reason).toBe('High confidence, high risk, urgent.');
    fireAway(harness, taskId);
    expect(harness.task(taskId).escalation?.handoff).toMatchObject({
      mergesAt: harness.now + CHECK,
      blockedBy: null,
    });
    expectMergeWaits(harness, taskId);
    fire(harness, taskId);
    const reason = `Urgent, and you were away while the merge waited ${waitedText(harness, taskId)}.`;
    judge(harness, taskId, reason);
    expectMerging(harness, taskId, reason);
    expect(harness.task(taskId).escalation).toBeNull();
  });

  test('stops promising the merge when something refuses it by then', () => {
    const { harness, taskId } = reachMerge({
      policy: { level: 'most' },
      priority: 'urgent',
      ratings: URGENT_HIGH,
    });
    fireAway(harness, taskId);
    const escalatedAt = harness.task(taskId).escalation?.at;
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    const reason = `Urgent, high risk, and you were away while the merge waited ${waitedText(harness, taskId)}.`;
    expect(harness.task(taskId).escalation).toMatchObject({
      at: escalatedAt,
      reason: `${reason} Your edits are not pushed yet.`,
      handoff: { mergesAt: null, blockedBy: 'edits_not_pushed' },
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Autopilot could not merge it',
    });
  });

  test('stops promising the merge, with the reason, when you come back before it', () => {
    const { harness, taskId } = reachMerge({
      policy: { level: 'most' },
      priority: 'urgent',
      ratings: URGENT_HIGH,
    });
    fireAway(harness, taskId);
    harness.advance(CHECK - MINUTE_MS);
    createTask(harness);
    fire(harness, taskId);
    expectMergeWaits(harness, taskId);
    expect(harness.task(taskId).escalation?.reason).toEndWith(
      'The risk is high, above what Autopilot does on its own.'
    );
    expect(harness.task(taskId).escalation?.handoff.mergesAt).toBeNull();
  });

  test('does nothing but clear the deadline once Autopilot is off or the task is no longer urgent', () => {
    const urgent = {
      policy: {},
      priority: 'urgent',
      ratings: { confidence: 'high', risk: 'medium' },
    } as const;
    const off = reachMerge(urgent);
    const dueAt = off.harness.openGate(off.taskId).autopilotDue?.at ?? 0;
    off.harness.send({ type: 'settings.change', patch: { autopilot: { enabled: false } } });
    expect(off.harness.openGate(off.taskId).autopilotDue).toBeNull();
    fire(off.harness, off.taskId, dueAt);
    expectMergeWaits(off.harness, off.taskId);
    const calm = reachMerge(urgent);
    const calmDue = calm.harness.openGate(calm.taskId).autopilotDue?.at ?? 0;
    calm.harness.send({ type: 'task.prioritize', taskId: calm.taskId, priority: 'normal' });
    fire(calm.harness, calm.taskId, calmDue);
    expectMergeWaits(calm.harness, calm.taskId);
  });

  test('starts checking when the task turns urgent while its merge waits, and keeps the check it has', () => {
    const { harness, taskId } = reachMerge({ policy: {}, ratings: { confidence: 'high', risk: 'medium' } });
    expect(harness.openGate(taskId).autopilotDue ?? null).toBeNull();
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    const due = harness.openGate(taskId).autopilotDue;
    expect(due).toEqual({ at: harness.now + CHECK });
    harness.advance(MINUTE_MS);
    harness.send({ type: 'settings.change', patch: { autopilot: { level: 'most' } } });
    expect(harness.openGate(taskId).autopilotDue).toEqual(due);
  });

  test('ignores a fire for a gate that closed, another task or nothing it knows', () => {
    const { harness, taskId } = reachMerge({ policy: {}, priority: 'urgent', ratings: URGENT_HIGH });
    const gate = harness.openGate(taskId);
    const dueAt = gate.autopilotDue?.at ?? 0;
    expect(harness.send({ type: 'autopilot.fire', taskId: 'gone', gateId: gate.id, dueAt }).events).toEqual(
      []
    );
    expect(harness.send({ type: 'autopilot.fire', taskId, gateId: 'gone', dueAt }).events).toEqual([]);
    expect(
      harness.send({ type: 'autopilot.fire', taskId, gateId: gate.id, dueAt: dueAt + 1 }).events
    ).toEqual([]);
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'revise', response: 'Rename it.' });
    expect(harness.send({ type: 'autopilot.fire', taskId, gateId: gate.id, dueAt }).events).toEqual([]);
  });

  test('an escalated change that is sent back is no longer escalated', () => {
    const { harness, taskId } = escalateTo();
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
  const policy: Partial<AutopilotPolicy> = { contacts };
  const { harness, taskId } = reachMerge({ policy, priority: 'urgent', ratings: URGENT_HIGH });
  fireAway(harness, taskId);
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
    expect(harness.task(taskId).escalation?.reason).toStartWith('Urgent, high risk');
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
    const policy: Partial<AutopilotPolicy> = { level: 'most', contacts: [ONCALL] };
    const { harness, taskId } = reachMerge({ policy, priority: 'urgent', ratings: URGENT_HIGH });
    fireAway(harness, taskId);
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

  test('records each contact’s reply on its own message only', () => {
    const { harness, taskId, escalatedAt } = escalateTo(ONCALL, KAI);
    recordSent(harness, taskId, escalatedAt);
    recordSent(harness, taskId, escalatedAt, null, KAI);
    answerMerge(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    harness.send({
      type: 'slack.record_escalation_follow_up',
      taskId,
      escalatedAt,
      contact: KAI,
      ts: '600.1',
    });
    expect(harness.task(taskId).slackEscalations?.map((post) => post.followUpTs)).toEqual([null, '600.1']);
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

function planGateHarness(policy: Partial<AutopilotPolicy> | null) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
  if (policy) harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, ...policy } } });
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId };
}

function askAgent(harness: Harness, taskId: string, gateId = 'q1') {
  harness.send({
    type: 'agent.ask',
    runId: harness.activeRun(taskId).id,
    gateId,
    question: 'Which tab group scrolls?',
    context: 'Two containers scroll.',
    choices: ['The outer one', 'The inner one'],
    recommendation: 'The inner one',
  });
}

describe('Autopilot judges each gate', () => {
  test('approves a small, clear plan it judged, and says why in the activity', () => {
    const { harness, taskId } = planGateHarness({});
    expect(harness.openGate(taskId)).toMatchObject({ type: 'plan', autopilotJudging: true });
    judge(harness, taskId, 'Two small phases with a clear goal.');
    expect(harness.task(taskId).stage).not.toBe('awaiting_plan');
    const plan = Object.values(harness.state.gates).find((gate) => gate.type === 'plan');
    expect(plan).toMatchObject({ status: 'answered', decision: 'approve' });
    expect(
      harness.task(taskId).activity.find((entry) => entry.text.startsWith('Approved for you'))
    ).toMatchObject({
      actor: 'shinsa',
      detail: 'Two small phases with a clear goal.',
    });
  });

  test('brings a plan it judged unclear to you, once in the activity, and keeps it out of judging', () => {
    const { harness, taskId } = planGateHarness({});
    judge(harness, taskId, 'The scope is unclear.', 'forward');
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'plan',
      status: 'open',
      autopilotJudging: false,
      autopilotHeld: 'The scope is unclear.',
    });
    const brought = harness.task(taskId).activity.filter((entry) => entry.text.startsWith('Brought to you'));
    expect(brought).toEqual([expect.objectContaining({ actor: 'shinsa', detail: 'The scope is unclear.' })]);
  });

  test('a forward without a reason still says the work needs you', () => {
    const { harness, taskId } = planGateHarness({});
    judge(harness, taskId, '  ', 'forward');
    expect(harness.openGate(taskId).autopilotHeld).toBe('Autopilot judged this needs you.');
  });

  test('says it judged the work clear when the model gave no reason', () => {
    const { harness, taskId } = planGateHarness({});
    judge(harness, taskId, '');
    expect(
      harness.task(taskId).activity.find((entry) => entry.text.startsWith('Approved for you'))?.detail
    ).toBe('Autopilot judged it clear and small enough to do for you.');
  });

  test('leaves a plan alone while Autopilot is off, and quietly holds one past its limits', () => {
    const off = planGateHarness(null);
    expect(off.harness.openGate(off.taskId).autopilotJudging ?? false).toBe(false);
    expect(off.harness.effectsOf('autopilot.judge')).toHaveLength(0);
    const held = planGateHarness({ gates: ['reviews'] });
    expect(held.harness.openGate(held.taskId)).toMatchObject({
      autopilotHeld: 'Autopilot does not act on this kind of gate.',
    });
    expect(held.harness.task(held.taskId).activity.some((entry) => entry.text.startsWith('Brought'))).toBe(
      false
    );
  });

  test('answers an agent’s question with the reply it wrote', () => {
    const { harness, taskId } = planGateHarness(null);
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true } } });
    approve(harness, taskId);
    askAgent(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'question', autopilotJudging: true });
    judge(harness, taskId, 'The agent recommends it and it matches the request.', 'act', ' The inner one. ');
    expect(harness.state.gates.q1).toMatchObject({
      status: 'answered',
      decision: 'reply',
      response: 'The inner one.',
    });
    expect(harness.lastEffect('question.resolve')).toMatchObject({ gateId: 'q1' });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      text: 'Answered for you by Autopilot: Which tab group scrolls?',
    });
  });

  test('leaves a question for you when it did not write a reply', () => {
    const { harness, taskId } = planGateHarness(null);
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true } } });
    approve(harness, taskId);
    askAgent(harness, taskId);
    judge(harness, taskId, 'Sure.', 'act', null);
    expect(harness.state.gates.q1).toMatchObject({
      status: 'open',
      autopilotHeld: 'Autopilot was not sure what to answer, so the question waits for you.',
    });
  });

  test('keeps a gate Autopilot is judging out of Needs you, with its task working', () => {
    const { harness, taskId } = planGateHarness({});
    const queue = resolveQueue(harness.state, harness.now);
    expect(queue.ready.some((entry) => entry.task.id === taskId)).toBe(false);
    expect(queue.working.some((task) => task.id === taskId)).toBe(true);
    judge(harness, taskId, 'Unclear.', 'forward');
    expect(resolveQueue(harness.state, harness.now).ready.some((entry) => entry.task.id === taskId)).toBe(
      true
    );
  });

  test('applies its limits again when the judgment comes back, and ignores one for a gate that moved on', () => {
    const { harness, taskId } = planGateHarness({});
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: false } } });
    judge(harness, taskId, 'Fine.');
    expect(harness.openGate(taskId)).toMatchObject({ status: 'open', autopilotHeld: 'Autopilot is off.' });
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, gates: ['reviews'] } } });
    const gate = harness.openGate(taskId);
    expect(
      harness.send({
        type: 'autopilot.judgment',
        taskId,
        gateId: gate.id,
        verdict: 'act',
        reason: 'x',
        reply: null,
        shadow: false,
      }).events
    ).toEqual([]);
    const second = planGateHarness({});
    const judging = second.harness.openGate(second.taskId);
    second.harness.send({ type: 'settings.change', patch: { autopilot: { gates: ['reviews'] } } });
    judge(second.harness, second.taskId, 'Fine.');
    expect(second.harness.openGate(second.taskId).autopilotHeld).toBe(
      'Autopilot does not act on this kind of gate.'
    );
    const third = planGateHarness({});
    approve(third.harness, third.taskId);
    const answered = Object.values(third.harness.state.gates).find((found) => found.type === 'plan');
    const late = {
      type: 'autopilot.judgment',
      taskId: third.taskId,
      gateId: answered?.id ?? '',
      verdict: 'act',
      reason: 'Late.',
      reply: null,
      shadow: false,
    } as const;
    expect(third.harness.send(late).events).toEqual([]);
    expect(third.harness.send({ ...late, gateId: 'gone' }).events).toEqual([]);
    expect(third.harness.send({ ...late, taskId: 'gone', gateId: judging.id }).events).toEqual([]);
  });

  test('brings a merge to you when something blocks it by the time it judged', () => {
    const { harness, taskId } = reachMerge({ policy: {} });
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    judge(harness, taskId, 'Clean.');
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'merge',
      autopilotHeld: 'Your edits are not pushed yet.',
    });
    expectMergeWaits(harness, taskId);
  });
});

function shadowJudge(harness: Harness, taskId: string, verdict: 'act' | 'forward', gateId?: string) {
  return harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gateId ?? harness.openGate(taskId).id,
    verdict,
    reason: 'A guess.',
    reply: null,
    shadow: true,
  });
}

describe('Autopilot guesses at what it brings to you', () => {
  test('asks for a guess once on a plan it may not act on, and acts on nothing', () => {
    const { harness, taskId } = planGateHarness({ gates: ['reviews'] });
    const gate = harness.openGate(taskId);
    expect(harness.effectsOf('autopilot.judge')).toEqual([
      { kind: 'autopilot.judge', taskId, gateId: gate.id, shadow: true },
    ]);
    harness.send({ type: 'settings.change', patch: { autopilot: { level: 'most' } } });
    expect(harness.effectsOf('autopilot.judge')).toHaveLength(1);
    shadowJudge(harness, taskId, 'act');
    expect(harness.openGate(taskId)).toMatchObject({ status: 'open', autopilotGuess: 'act' });
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    expect(shadowJudge(harness, taskId, 'forward').events).toEqual([]);
    expect(harness.openGate(taskId).autopilotGuess).toBe('act');
  });

  test('scores your answer against its guess', () => {
    const { harness, taskId } = planGateHarness({ gates: ['reviews'] });
    shadowJudge(harness, taskId, 'act');
    approve(harness, taskId);
    expect(harness.state.autopilotProfile.decisions.at(-1)).toMatchObject({
      kind: 'plan',
      answer: 'approved',
      guess: 'act',
    });
  });

  test('keeps its own verdict as the guess when it judged a gate it brings to you', () => {
    const { harness, taskId } = planGateHarness({});
    judge(harness, taskId, 'The scope is unclear.', 'forward');
    expect(harness.openGate(taskId).autopilotGuess).toBe('forward');
    expect(harness.effectsOf('autopilot.judge').filter((effect) => effect.shadow)).toHaveLength(0);
  });

  test('keeps a verdict to act as the guess when a limit refused it by the time it judged', () => {
    const { harness, taskId } = planGateHarness({});
    harness.send({ type: 'settings.change', patch: { autopilot: { gates: ['reviews'] } } });
    judge(harness, taskId, 'Fine.');
    expect(harness.openGate(taskId)).toMatchObject({ status: 'open', autopilotGuess: 'act' });
  });

  test('ignores a guess for a gate it is still judging, and a judgment that arrives as the wrong kind', () => {
    const { harness, taskId } = planGateHarness({});
    expect(shadowJudge(harness, taskId, 'act').events).toEqual([]);
    const held = planGateHarness({ gates: ['reviews'] });
    expect(
      held.harness.send({
        type: 'autopilot.judgment',
        taskId: held.taskId,
        gateId: held.harness.openGate(held.taskId).id,
        verdict: 'act',
        reason: 'x',
        reply: null,
        shadow: false,
      }).events
    ).toEqual([]);
  });

  test('asks for no guess on an agent question or while Autopilot is off', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, gates: ['reviews'] } } });
    const taskId = createTask(harness);
    askAgent(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'question', autopilotHeld: expect.any(String) });
    expect(harness.effectsOf('autopilot.judge')).toHaveLength(0);
    const off = planGateHarness(null);
    expect(off.harness.effectsOf('autopilot.judge')).toHaveLength(0);
  });
});
