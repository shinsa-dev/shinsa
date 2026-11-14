import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_DEFAULTS,
  AUTOPILOT_LIMITS,
  type AutopilotFacts,
  type AutopilotPolicy,
  HOUR_MS,
  MINUTE_MS,
  resolveAutopilotFacts,
  resolveAutopilotLimits,
  resolveAutopilotPresence,
  type Task,
} from '../../src/index.ts';
import { createHarness, createTask, proposePlan } from '../harness.ts';

const ON: AutopilotPolicy = { ...AUTOPILOT_DEFAULTS, enabled: true };

const AWAY = {
  inHours: false,
  active: false,
  awayMinutes: AUTOPILOT_LIMITS.awayMinutes,
} as const;

const FACTS: AutopilotFacts = {
  gate: 'merge',
  urgent: true,
  watchdog: true,
  confidence: 'high',
  risk: 'high',
  scope: { phases: 2, files: 3 },
  heldPlan: false,
  escalatedReview: false,
  approvedByYou: false,
  waitedMinutes: AUTOPILOT_LIMITS.awayMinutes,
  presence: AWAY,
};

function act(facts: Partial<AutopilotFacts>, policy: Partial<AutopilotPolicy> = {}) {
  return resolveAutopilotLimits({ ...FACTS, ...facts }, { ...ON, ...policy }).act;
}

function escalate(facts: Partial<AutopilotFacts>, policy: Partial<AutopilotPolicy> = {}) {
  return resolveAutopilotLimits({ ...FACTS, ...facts }, { ...ON, ...policy }).escalate;
}

describe('where you are', () => {
  test('is unknown before Shinsa saw you, active within half an hour, and away after', () => {
    const now = 10 * HOUR_MS + 50 * MINUTE_MS;
    expect(resolveAutopilotPresence({ ...createHarness().state, presence: {} }, now)).toEqual({
      inHours: null,
      active: false,
      awayMinutes: null,
    });
    const seen = { ...createHarness().state, presence: { '10': 1 } };
    expect(resolveAutopilotPresence(seen, now)).toMatchObject({ active: true, awayMinutes: 0 });
    expect(resolveAutopilotPresence(seen, 11 * HOUR_MS + 31 * MINUTE_MS)).toMatchObject({
      active: false,
      awayMinutes: 31,
    });
  });

  test('says whether now is inside the hours you set', () => {
    const state = {
      ...createHarness().state,
      timeZone: 'UTC',
      settings: { ...createHarness().state.settings, activeHours: [{ weekday: 4, from: 9, to: 17 }] },
    };
    expect(resolveAutopilotPresence(state, 10 * HOUR_MS).inHours).toBe(true);
    expect(resolveAutopilotPresence(state, 20 * HOUR_MS).inHours).toBe(false);
  });
});

describe('the facts of a gate', () => {
  test('read the task, its plan, who filed it and how long the gate waited', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { priority: 'urgent' });
    proposePlan(harness, taskId);
    const task: Task = {
      ...harness.task(taskId),
      reviewRatings: { confidence: 'high', risk: 'low' },
      createdBy: { kind: 'watchdog', taskId: 'shipped', runId: 'run-1', requestKey: 'k' },
    };
    const document = task.plan?.document;
    const facts = resolveAutopilotFacts(
      harness.state,
      task,
      'plan',
      harness.now - 90 * MINUTE_MS,
      harness.now
    );
    expect(facts).toMatchObject({
      gate: 'plan',
      urgent: true,
      watchdog: true,
      confidence: 'high',
      risk: 'low',
      scope: { phases: document?.phases.length, files: document?.files.length },
      approvedByYou: true,
      waitedMinutes: 90,
    });
  });

  test('know nothing of a plan before there is one, and never a negative wait', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    const facts = resolveAutopilotFacts(
      harness.state,
      task,
      'question',
      harness.now + MINUTE_MS,
      harness.now
    );
    expect(facts).toMatchObject({
      scope: null,
      confidence: null,
      risk: null,
      watchdog: false,
      waitedMinutes: 0,
    });
  });

  test.each([
    ['plan first', { planFirst: true }],
    ['in the backlog', { backlog: { at: 0 } }],
  ] as const)('hold a plan you asked to see: %s', (_case, change) => {
    const harness = createHarness();
    const task = { ...harness.task(createTask(harness)), ...change };
    expect(resolveAutopilotFacts(harness.state, task, 'plan', harness.now, harness.now).heldPlan).toBe(true);
  });
});

describe('what Autopilot may do on its own', () => {
  test('nothing while it is off', () => {
    expect(act({}, { enabled: false })).toEqual({
      allowed: false,
      reason: 'Autopilot is off.',
      setting: true,
    });
  });

  test('approves a plan within its size, and never one that asks for you or runs too large', () => {
    expect(act({ gate: 'plan' })).toEqual({ allowed: true });
    expect(act({ gate: 'plan', heldPlan: true })).toMatchObject({ allowed: false, setting: true });
    expect(act({ gate: 'plan', scope: null })).toEqual({
      allowed: false,
      reason: 'The plan has no phases yet.',
      setting: false,
    });
    const large = { gate: 'plan', scope: { phases: 5, files: 3 } } as const;
    expect(act(large)).toEqual({
      allowed: false,
      reason: 'The plan is larger than Autopilot approves on its own.',
      setting: false,
    });
    expect(act(large, { level: 'most' })).toEqual({ allowed: true });
    expect(act({ gate: 'plan', scope: { phases: 2, files: 5 } }, { level: 'ask_first' })).toMatchObject({
      allowed: false,
    });
  });

  test('may answer an agent only when questions are among its gates', () => {
    expect(act({ gate: 'question' })).toEqual({ allowed: true });
    expect(act({ gate: 'question' }, { gates: ['plans', 'reviews'] })).toEqual({
      allowed: false,
      reason: 'Autopilot does not act on this kind of gate.',
      setting: true,
    });
  });

  test('approves no review the reviewer did not rate', () => {
    expect(act({ gate: 'review', confidence: null, risk: null })).toEqual({
      allowed: false,
      reason: 'The reviewer did not rate the change.',
      setting: false,
    });
  });

  test('merges nothing with Auto merge off', () => {
    expect(act({ risk: 'low' }, { autoMerge: 'off' })).toEqual({
      allowed: false,
      reason: 'Auto merge is off.',
      setting: true,
    });
  });

  test('merges higher risk only for an urgent change once you have been away long enough', () => {
    expect(act({ risk: 'medium' })).toEqual({ allowed: true });
    expect(act({ risk: 'medium', urgent: false })).toMatchObject({ allowed: false });
    expect(act({ risk: 'medium', waitedMinutes: 10 })).toMatchObject({ allowed: false });
    expect(act({ risk: 'medium', presence: { ...AWAY, awayMinutes: null } })).toMatchObject({
      allowed: false,
    });
    expect(act({ risk: 'high' }, { level: 'most', autoMerge: 'approved' })).toEqual({ allowed: true });
  });
});

describe('when Autopilot may contact your team', () => {
  test('only for an urgent, high-risk change after you have been away an hour', () => {
    expect(escalate({})).toEqual({ allowed: true });
  });

  test.each([
    ['it is off', {}, { enabled: false }, 'Autopilot does not contact your team.'],
    ['you turned it off', {}, { escalate: false }, 'Autopilot does not contact your team.'],
    ['the change is not urgent', { urgent: false }, {}, 'Only urgent changes go to your team.'],
    ['the risk is not high', { risk: 'medium' }, {}, 'Only high risk changes go to your team.'],
    [
      'you are active',
      { presence: { inHours: true, active: true, awayMinutes: 0 } },
      {},
      'You are active, so it stays with you.',
    ],
    [
      'you have not been away long',
      { presence: { ...AWAY, awayMinutes: 20 } },
      {},
      'It goes to your team only after you have been away 60 minutes.',
    ],
  ] as const)('never when %s', (_case, facts, policy, reason) => {
    expect(escalate(facts, policy)).toEqual({ allowed: false, reason, setting: false });
  });
});

function revise(facts: Partial<AutopilotFacts>, policy: Partial<AutopilotPolicy> = {}) {
  return resolveAutopilotLimits({ ...FACTS, ...facts }, { ...ON, ...policy }).revise;
}

describe('the follow-up limit', () => {
  test('lets Autopilot follow up past the risk and size it would approve', () => {
    expect(revise({ gate: 'review', risk: 'high', confidence: 'low', urgent: false })).toEqual({
      allowed: true,
    });
    expect(revise({ gate: 'plan', scope: { phases: 8, files: 40 } }, { level: 'ask_first' })).toEqual({
      allowed: true,
    });
    expect(revise({ gate: 'merge', risk: 'high' })).toEqual({ allowed: true });
  });

  test('never follows up where you must decide', () => {
    expect(revise({ gate: 'review' }, { enabled: false })).toMatchObject({
      reason: 'Autopilot is off.',
      setting: true,
    });
    expect(revise({ gate: 'question' })).toMatchObject({
      reason: 'Autopilot follows up only on plans, reviews and merges.',
      setting: true,
    });
    expect(revise({ gate: 'proposal' })).toMatchObject({ allowed: false });
    expect(revise({ gate: 'review' }, { gates: ['plans'] })).toMatchObject({
      reason: 'Autopilot does not act on this kind of gate.',
    });
    expect(revise({ gate: 'plan', heldPlan: true })).toMatchObject({ allowed: false, setting: true });
    expect(revise({ gate: 'plan', scope: null })).toMatchObject({ reason: 'The plan has no phases yet.' });
    expect(revise({ gate: 'review', escalatedReview: true })).toMatchObject({
      reason: 'The agents could not settle the review.',
    });
    expect(revise({ gate: 'merge' }, { autoMerge: 'off' })).toMatchObject({ reason: 'Auto merge is off.' });
    expect(revise({ gate: 'merge', approvedByYou: true })).toMatchObject({
      reason: 'You approved the review yourself.',
    });
  });
});
