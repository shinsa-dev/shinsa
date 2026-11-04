import { describe, expect, test } from 'bun:test';
import {
  isOverBudget,
  listActiveRuns,
  listOpenGates,
  type RunUsage,
  RECENT_USAGE_MS,
  resolveRecentUsage,
  resolveTaskCost,
  USAGE_RATE_LIMITS,
} from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan, registerRepo } from '../harness.ts';

function usage(costUsd: number | null, tokens = 1_000): RunUsage {
  return { inputTokens: tokens, outputTokens: tokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd };
}

function meter(harness: Harness, taskId: string, costUsd: number | null) {
  harness.send({ type: 'run.meter', runId: harness.activeRun(taskId).id, usage: usage(costUsd) });
}

function limited(capUsd: number) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { taskBudgetUsd: capUsd } });
  const taskId = createTask(harness);
  return { harness, taskId };
}

describe('metering runs', () => {
  test('adds each report to the run, and an unpriced part makes the run unpriced', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    meter(harness, taskId, 0.5);
    meter(harness, taskId, 0.25);
    expect(harness.state.runs[runId]?.usage).toEqual({
      inputTokens: 2_000,
      outputTokens: 2_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.75,
    });
    meter(harness, taskId, null);
    expect(harness.state.runs[runId]?.usage?.costUsd).toBeNull();
  });

  test('a late report still counts, an unknown run is ignored and nonsense is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId).id;
    proposePlan(harness, taskId);
    harness.send({ type: 'run.meter', runId: planner, usage: usage(1) });
    expect(harness.state.runs[planner]?.usage?.costUsd).toBe(1);
    expect(harness.send({ type: 'run.meter', runId: 'gone', usage: usage(1) }).events).toEqual([]);
    expect(() =>
      harness.send({ type: 'run.meter', runId: planner, usage: { ...usage(1), inputTokens: -1 } })
    ).toThrow('Token counts and cost must be zero or more.');
    expect(() =>
      harness.send({ type: 'run.meter', runId: planner, usage: usage(Number.POSITIVE_INFINITY) })
    ).toThrow('Token counts and cost must be zero or more.');
  });

  test('a session reports its running total, and each run is charged what that session added since its last report', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const first = harness.activeRun(taskId).id;
    const report = (runId: string, sessionId: string, tokens: number, costUsd: number | null) =>
      harness.send({ type: 'run.meter', runId, sessionId, usage: usage(costUsd, tokens) });
    report(first, 's1', 10, 1);
    report(first, 's2', 30, 3);
    expect(harness.state.runs[first]?.usage).toMatchObject({ inputTokens: 40, costUsd: 4 });
    proposePlan(harness, taskId);
    const second = harness.activeRun(taskId).id;
    report(second, 's2', 35, 3.5);
    expect(harness.state.runs[second]?.usage).toMatchObject({ inputTokens: 5, outputTokens: 5 });
    expect(harness.state.runs[second]?.usage?.costUsd).toBeCloseTo(0.5);
    expect(report(second, 's2', 35, 3.5).events).toEqual([]);
    report(second, 's2', 40, null);
    expect(harness.state.runs[second]?.usage).toMatchObject({ inputTokens: 10, costUsd: null });
  });
});

describe('the cost limit per task', () => {
  test('a task over its limit pauses before its next step instead of stopping a running agent', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', cause: 'budget', title: 'Reached its cost limit' });
    expect(gate.body).toBe(
      'This task reached its $5.00 cost limit, so the next step did not start. Continue to allow another $5.00, or cancel the task.'
    );
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('continuing allows another full limit', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(harness.task(taskId).budgetAcknowledgedUsd).toBe(6);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
    meter(harness, taskId, 4);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('raising the limit releases tasks it paused', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    proposePlan(harness, taskId);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 20 } });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
  });

  test('turning the limit off releases them too, and keeps other pauses', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    proposePlan(harness, taskId);
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'effect.fail', taskId: other, title: 'Broke', detail: 'x' });
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: null } });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.openGate(other).title).toBe('Broke');
  });

  test('retrying after you raised the limit does not count as continuing', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 10 } });
    expect(harness.state.gates[gate.id]?.status).toBe('withdrawn');
    expect(harness.task(taskId).budgetAcknowledgedUsd).toBeUndefined();
  });

  test('unpriced work never trips the limit on its own', () => {
    const { harness, taskId } = limited(1);
    meter(harness, taskId, null);
    proposePlan(harness, taskId);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('the limit must be an amount above zero', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 0 } })).toThrow(
      'The cost limit must be above zero.'
    );
  });
});

function learnUsageRate(harness: Harness) {
  const start = harness.now - 100_000;
  for (let index = 0; index < USAGE_RATE_LIMITS.minTasks; index += 1) {
    const from = start + index * 1_000;
    const id = `learned-${index}`;
    const readings = [
      { percent: index * 2, at: from, resetsAt: null },
      { percent: index * 2 + 2, at: from + 100, resetsAt: null },
    ];
    harness.state.runs[id] = {
      id,
      taskId: `learned-task-${index}`,
      role: 'agent',
      purpose: 'build',
      provider: 'claude',
      model: null,
      sessionId: null,
      startedAt: from,
      endedAt: from + 100,
      outcome: 'completed',
      summary: null,
      usage: usage(2),
      meters: [{ attemptId: id, window: 'account:acc-1', from, to: from + 100, usage: usage(2), readings }],
    };
  }
}

function meterWeekly(
  harness: Harness,
  taskId: string,
  percent: number,
  sessionId?: string,
  costUsd = percent
) {
  const run = harness.activeRun(taskId);
  if ((run.attempts ?? []).length === 0) {
    harness.send({
      type: 'run.attempt',
      runId: run.id,
      attemptId: `${run.id}-attempt`,
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      account: { id: 'acc-1', email: null },
    });
  }
  const attempt = harness.activeRun(taskId).attempts?.at(-1);
  const last = run.meters?.at(-1)?.readings.at(-1) ?? {
    percent: 0,
    at: attempt?.startedAt ?? 0,
    resetsAt: null,
  };
  return harness.send({
    type: 'run.meter',
    runId: run.id,
    usage: usage(costUsd),
    readings: [last, { percent: last.percent + percent, at: harness.now + 1, resetsAt: null }],
    ...(sessionId ? { sessionId } : {}),
  });
}

function weeklyShare(harness: Harness, taskId: string) {
  return resolveTaskCost(harness.state, harness.task(taskId)).total.weeklyPercent;
}

function limitedByUsage(percent: number) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { taskUsageLimit: percent } });
  const taskId = createTask(harness);
  learnUsageRate(harness);
  return { harness, taskId };
}

function answerGate(harness: Harness, taskId: string) {
  harness.send({
    type: 'gate.answer',
    gateId: harness.openGate(taskId).id,
    decision: 'approve',
    response: null,
  });
}

describe('metering the weekly usage a run used', () => {
  test('keeps the readings on the attempt, and charges the run its cost at the account’s rate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    learnUsageRate(harness);
    const runId = harness.activeRun(taskId).id;
    meterWeekly(harness, taskId, 1.5);
    meterWeekly(harness, taskId, 2);
    expect(weeklyShare(harness, taskId)).toBe(3.5);
    meterWeekly(harness, taskId, 0);
    expect(weeklyShare(harness, taskId)).toBe(3.5);
    expect(harness.state.runs[runId]?.meters).toEqual([
      expect.objectContaining({
        attemptId: `${runId}-attempt`,
        window: 'account:acc-1',
        readings: expect.any(Array),
      }),
    ]);
  });

  test('a session that reports the same totals still records the readings it took', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    meterWeekly(harness, taskId, 1, 's1', 0.1);
    const same = {
      inputTokens: 1_000,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.1,
    };
    expect(harness.send({ type: 'run.meter', runId, sessionId: 's1', usage: same }).events).toEqual([]);
    expect(meterWeekly(harness, taskId, 2, 's1', 0.1).events).toHaveLength(1);
    expect(harness.state.runs[runId]?.meters?.[0]?.readings).toHaveLength(4);
    expect(harness.state.runs[runId]).toMatchObject({ usage: { costUsd: 0.1 } });
  });

  test('a run metered before it had an attempt keeps its cost and has no weekly share', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'run.meter',
      runId,
      usage: usage(0.2),
      readings: [{ percent: 4, at: 1, resetsAt: null }],
    });
    expect(harness.state.runs[runId]?.meters).toBeUndefined();
    expect(resolveTaskCost(harness.state, harness.task(taskId)).total).toMatchObject({
      knownUsd: 0.2,
      weeklyRuns: 0,
    });
  });

  test('a reading outside 0 to 100, or without a time, is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const meterReading = (percent: number, at: number, resetsAt: number | null = null) =>
      harness.send({ type: 'run.meter', runId, usage: usage(0.1), readings: [{ percent, at, resetsAt }] });
    expect(() => meterReading(-1, 1)).toThrow(
      'A weekly reading must be a percentage from 0 to 100 with a time and a reset time or none.'
    );
    expect(() => meterReading(101, 1)).toThrow('from 0 to 100');
    expect(() => meterReading(5, Number.NaN)).toThrow('from 0 to 100');
    expect(() => meterReading(5, 1, -1)).toThrow('from 0 to 100');
  });
});

describe('the usage limit per task', () => {
  test('is off by default', () => {
    expect(createHarness().state.settings.taskUsageLimit).toBeNull();
  });

  test('a task past its share of the weekly limit pauses before its next step', () => {
    const { harness, taskId } = limitedByUsage(10);
    meterWeekly(harness, taskId, 12.4);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', cause: 'budget', title: 'Reached its usage limit' });
    expect(gate.body).toBe(
      'This task reached its usage limit of 10% of the weekly limit, so the next step did not start. Continue to allow another 10%, or cancel the task.'
    );
  });

  test('continuing allows another share of the weekly limit', () => {
    const { harness, taskId } = limitedByUsage(10);
    meterWeekly(harness, taskId, 12);
    proposePlan(harness, taskId);
    answerGate(harness, taskId);
    expect(harness.task(taskId).usageAcknowledgedPercent).toBe(12);
    expect(harness.task(taskId).budgetAcknowledgedUsd).toBeUndefined();
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
  });

  test('continuing past both limits allows another of each', () => {
    const { harness, taskId } = limitedByUsage(10);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 1 } });
    meterWeekly(harness, taskId, 11);
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId).title).toBe('Reached its usage limit');
    answerGate(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({ usageAcknowledgedPercent: 11, budgetAcknowledgedUsd: 11 });
  });

  test('raising or switching off the limit releases the tasks it paused', () => {
    const { harness, taskId } = limitedByUsage(10);
    meterWeekly(harness, taskId, 12);
    proposePlan(harness, taskId);
    harness.send({ type: 'settings.change', patch: { taskUsageLimit: 20 } });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    const second = limitedByUsage(5);
    meterWeekly(second.harness, second.taskId, 6);
    proposePlan(second.harness, second.taskId);
    second.harness.send({ type: 'settings.change', patch: { taskUsageLimit: null } });
    expect(listOpenGates(second.harness.state, second.taskId)).toHaveLength(0);
  });

  test('work that was not measured never trips the usage limit', () => {
    const { harness, taskId } = limitedByUsage(1);
    meter(harness, taskId, 50);
    proposePlan(harness, taskId);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('on an account still learning its rate, the usage limit counts the early estimate and says so', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { taskUsageLimit: 10 } });
    const taskId = createTask(harness);
    meterWeekly(harness, taskId, 12);
    expect(weeklyShare(harness, taskId)).toBe(0);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ cause: 'budget', title: 'Reached its usage limit' });
    expect(gate.body).toBe(
      'This task reached its usage limit of 10% of the weekly limit, so the next step did not start. The share is an early estimate while Shinsa learns the account’s rate. Continue to allow another 10%, or cancel the task.'
    );
  });

  test('before an account has any estimate, the usage limit cannot count, and a cost limit still holds', () => {
    const idle = (harness: Harness, taskId: string) => {
      const run = harness.activeRun(taskId);
      harness.send({
        type: 'run.attempt',
        runId: run.id,
        attemptId: `${run.id}-attempt`,
        provider: 'claude',
        model: null,
        resumed: false,
        handoff: null,
        account: { id: 'acc-1', email: null },
      });
      harness.send({
        type: 'run.meter',
        runId: run.id,
        usage: usage(6),
        readings: [
          { percent: 0, at: harness.now, resetsAt: null },
          { percent: 40, at: harness.now + 60 * 60_000, resetsAt: null },
        ],
      });
    };
    const usageOnly = createHarness();
    usageOnly.send({ type: 'settings.change', patch: { taskUsageLimit: 1 } });
    const unlimited = createTask(usageOnly);
    idle(usageOnly, unlimited);
    expect(resolveTaskCost(usageOnly.state, usageOnly.task(unlimited)).total).toMatchObject({
      learningRuns: 1,
      estimatedPercent: 0,
    });
    proposePlan(usageOnly, unlimited);
    expect(listOpenGates(usageOnly.state, unlimited)).toHaveLength(0);
    const both = createHarness();
    both.send({ type: 'settings.change', patch: { taskUsageLimit: 1, taskBudgetUsd: 5 } });
    const capped = createTask(both);
    idle(both, capped);
    proposePlan(both, capped);
    expect(both.openGate(capped)).toMatchObject({ cause: 'budget', title: 'Reached its cost limit' });
  });

  test('the limit must be a whole percentage from 1 to 100', () => {
    const harness = createHarness();
    for (const taskUsageLimit of [0, 101, 2.5]) {
      expect(() => harness.send({ type: 'settings.change', patch: { taskUsageLimit } })).toThrow(
        'The usage limit must be 1 to 100%.'
      );
    }
  });
});

describe('delegated work', () => {
  test('a delegated agent’s usage counts toward its task’s cost, its role and the cost limit', () => {
    const { harness, taskId } = limited(1);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId).id;
    const before = new Set(Object.keys(harness.state.runs));
    harness.send({
      type: 'agent.delegate',
      runId: builder,
      requestKey: 'survey',
      title: 'Survey the callers',
      brief: 'List every caller of runExport and what it passes.',
      role: 'reviewer',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const delegated = Object.keys(harness.state.runs).find((id) => !before.has(id)) ?? '';
    harness.send({ type: 'run.meter', runId: builder, usage: usage(0.4) });
    harness.send({ type: 'run.meter', runId: delegated, usage: usage(0.7) });
    const task = harness.task(taskId);
    const cost = resolveTaskCost(harness.state, task);
    expect(cost.total).toMatchObject({ runs: 2, knownUsd: 1.1 });
    expect(cost.byRole.map(({ role, cost: line }) => [role, line.knownUsd])).toEqual([
      ['agent', 0.4],
      ['reviewer', 0.7],
    ]);
    expect(isOverBudget(harness.state, task)).toBe(true);
  });
});

function recentPercent(harness: Harness, projectId: string | null = null) {
  return resolveRecentUsage(harness.state, harness.now, { provider: 'claude', projectId }).percent;
}

function heldAtPace(patch: { daily?: number; project?: number }) {
  const harness = createHarness();
  const taskId = createTask(harness);
  learnUsageRate(harness);
  const projectId = harness.task(taskId).projectId as string;
  meterWeekly(harness, taskId, 6);
  if (patch.daily !== undefined) {
    harness.send({
      type: 'settings.change',
      patch: { dailyUsageLimit: recentPercent(harness) + patch.daily },
    });
  }
  if (patch.project !== undefined) {
    const project = harness.state.projects[projectId];
    if (!project) throw new Error('no project');
    harness.send({
      type: 'project.write',
      project: { ...project, usageLimit: recentPercent(harness, projectId) + patch.project },
    });
  }
  proposePlan(harness, taskId);
  const run = Object.values(harness.state.runs)
    .filter((candidate) => candidate.taskId === taskId)
    .at(-1);
  if (!run) throw new Error('no run');
  return { harness, taskId, projectId, run };
}

function isDispatched(harness: Harness, runId: string) {
  return harness.effectsOf('run.execute').some((effect) => effect.runId === runId);
}

function listContinuations(harness: Harness, runId: string): string[] {
  const next = Object.values(harness.state.runs).filter((candidate) => candidate.continues === runId);
  return next.flatMap((candidate) => [candidate.id, ...listContinuations(harness, candidate.id)]);
}

function isHeldStepStarted(harness: Harness, runId: string) {
  return listContinuations(harness, runId).some((id) => isDispatched(harness, id));
}

function waitOf(harness: Harness, taskId: string) {
  const wait = harness.task(taskId).usageWait;
  if (!wait) throw new Error('no usage wait');
  return wait;
}

describe('the daily usage limit', () => {
  test('is off by default, and must be above zero', () => {
    const harness = createHarness();
    expect(harness.state.settings.dailyUsageLimit).toBeNull();
    expect(() => harness.send({ type: 'settings.change', patch: { dailyUsageLimit: 0 } })).toThrow(
      'The daily usage limit must be above zero.'
    );
    expect(() =>
      harness.send({ type: 'settings.change', patch: { dailyUsageLimit: Number.POSITIVE_INFINITY } })
    ).toThrow('The daily usage limit must be above zero.');
    harness.send({ type: 'settings.change', patch: { dailyUsageLimit: 12.5 } });
    expect(harness.state.settings.dailyUsageLimit).toBe(12.5);
  });

  test('holds the next step once the last 24 hours reach it, and says why', () => {
    const { harness, taskId, run } = heldAtPace({ daily: -1 });
    expect(harness.state.runs[run.id]).toMatchObject({
      status: 'queued',
      outcome: 'cancelled',
      summary: 'Held at a usage limit before it started.',
    });
    expect(harness.state.runs[run.id]?.endedAt).not.toBeNull();
    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
    expect(isDispatched(harness, run.id)).toBe(false);
    const wait = waitOf(harness, taskId);
    expect(wait).toMatchObject({
      runId: run.id,
      cause: 'pace',
      status: 'armed',
      autoResume: true,
      account: null,
      pace: { scope: 'daily', projectId: null },
    });
    expect(wait.pace?.percent).toBeCloseTo(recentPercent(harness));
    expect(wait.resetAt).toBeGreaterThan(harness.now);
    expect(wait.resetAt).toBeLessThanOrEqual(harness.now + RECENT_USAGE_MS);
    expect(harness.task(taskId).stageReason).toBe('held at the daily usage limit');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Held the next step at the daily usage limit; it starts when the last 24 hours drop below it'
    );
    const before = harness.events.length;
    harness.send({ type: 'settings.change', patch: { autoResume: false } });
    expect(harness.events.slice(before).filter((event) => event.type === 'usage_wait.armed')).toHaveLength(0);
  });

  test('a step under the limit starts as usual', () => {
    const { harness, taskId, run } = heldAtPace({ daily: 50 });
    expect(isDispatched(harness, run.id)).toBe(true);
    expect(harness.task(taskId).usageWait ?? null).toBeNull();
  });

  test('starts the held step by itself once older usage drops out of the window', () => {
    const { harness, taskId, run } = heldAtPace({ daily: -1 });
    const wait = waitOf(harness, taskId);
    const reason = wait.pace?.stageReason;
    harness.send({ type: 'usage_wait.resume', taskId, waitId: wait.id });
    expect(isHeldStepStarted(harness, run.id)).toBe(false);
    harness.advance(wait.resetAt - harness.now);
    harness.send({ type: 'usage_wait.resume', taskId, waitId: wait.id });
    expect(isHeldStepStarted(harness, run.id)).toBe(true);
    const [started] = listContinuations(harness, run.id);
    const held = harness.state.runs[run.id];
    expect(harness.state.runs[started as string]).toMatchObject({
      prompt: held?.prompt,
      role: held?.role,
      phaseIndex: held?.phaseIndex,
      usageWaitId: wait.id,
      status: 'running',
    });
    expect(waitOf(harness, taskId).status).toBe('resumed');
    expect(harness.task(taskId).stageReason).toBe(reason as string);
    expect(harness.task(taskId).activity.some((entry) => entry.text === 'Started the held step')).toBe(true);
  });

  test('holds the step again when the window is still over the limit at the reset', () => {
    const { harness, taskId, run } = heldAtPace({ daily: -1 });
    const first = waitOf(harness, taskId);
    const reason = first.pace?.stageReason;
    harness.send({ type: 'settings.change', patch: { dailyUsageLimit: 0.5 } });
    expect(waitOf(harness, taskId).id).toBe(first.id);
    harness.advance(first.resetAt - harness.now);
    harness.send({ type: 'usage_wait.resume', taskId, waitId: first.id });
    const second = waitOf(harness, taskId);
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ status: 'armed', cause: 'pace' });
    expect(harness.state.runs[second.runId]?.continues).toBe(run.id);
    expect(second.resetAt).toBeGreaterThan(first.resetAt);
    expect(second.pace?.stageReason).toBe(reason);
    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
    expect(isHeldStepStarted(harness, run.id)).toBe(false);
  });

  test('Resume now starts the held step at once, over the limit or not', () => {
    const { harness, taskId, run } = heldAtPace({ daily: -1 });
    harness.send({ type: 'usage_wait.resume_now', taskId });
    expect(isHeldStepStarted(harness, run.id)).toBe(true);
    expect(harness.task(taskId).activity.some((entry) => entry.text === 'Started the held step early')).toBe(
      true
    );
  });

  test('raising or clearing the limit starts held steps right away', () => {
    const { harness, taskId, run } = heldAtPace({ daily: -1 });
    harness.send({ type: 'settings.change', patch: { dailyUsageLimit: null } });
    expect(isHeldStepStarted(harness, run.id)).toBe(true);
    expect(waitOf(harness, taskId).status).toBe('resumed');
  });

  test('a held step always starts by itself, so it cannot be set to wait', () => {
    const { harness, taskId } = heldAtPace({ daily: -1 });
    expect(() => harness.send({ type: 'usage_wait.change', taskId, autoResume: false })).toThrow(
      'A step held at a usage limit always starts by itself. Resume it now, or raise the limit.'
    );
  });

  test('holds a task whose project was removed too', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    learnUsageRate(harness);
    meterWeekly(harness, taskId, 6);
    harness.send({ type: 'project.remove', projectId: harness.task(taskId).projectId as string });
    harness.send({ type: 'settings.change', patch: { dailyUsageLimit: recentPercent(harness) - 1 } });
    proposePlan(harness, taskId);
    expect(waitOf(harness, taskId).pace?.scope).toBe('daily');
  });

  test('never holds work an agent delegates within a step that already started', () => {
    const { harness, run } = heldAtPace({ daily: 50 });
    harness.send({ type: 'settings.change', patch: { dailyUsageLimit: 0.1 } });
    const before = new Set(Object.keys(harness.state.runs));
    harness.send({
      type: 'agent.delegate',
      runId: run.id,
      requestKey: 'pace-child',
      title: 'Check the copy',
      brief: 'Read the strings in src/copy.ts and report any that break the copy rules.',
      role: 'reviewer',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const childId = Object.keys(harness.state.runs).find((id) => !before.has(id));
    expect(childId).toBeDefined();
    expect(isDispatched(harness, childId as string)).toBe(true);
  });

  test('only you change it', () => {
    const harness = createHarness();
    expect(() =>
      harness.send({ type: 'settings.change', patch: { dailyUsageLimit: 20 } }, { onBehalf: true })
    ).toThrow('Only the human changes the settings dailyUsageLimit.');
  });
});

describe('a project’s usage limit', () => {
  test('holds only that project’s tasks, and says which limit', () => {
    const { harness, taskId, projectId, run } = heldAtPace({ project: -1 });
    expect(harness.state.projects[projectId]?.usageLimit).toBeGreaterThan(0);
    expect(waitOf(harness, taskId)).toMatchObject({ runId: run.id, pace: { scope: 'project', projectId } });
    expect(harness.task(taskId).stageReason).toBe('held at the project’s usage limit');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Held the next step at the project’s usage limit; it starts when the last 24 hours drop below it'
    );
    const otherRepo = registerRepo(harness, 'marketing', 'Marketing');
    const other = createTask(harness, { repoId: otherRepo });
    expect(isDispatched(harness, harness.activeRun(other).id)).toBe(true);
  });

  test('when both limits hold a step, it waits for the later one', () => {
    const daily = heldAtPace({ daily: -1 }).harness;
    const both = heldAtPace({ daily: -1, project: -5.5 });
    const dailyOnly = Object.values(daily.state.tasks)[0]?.usageWait?.resetAt ?? 0;
    expect(waitOf(both.harness, both.taskId).pace?.scope).toBe('project');
    expect(waitOf(both.harness, both.taskId).resetAt).toBeGreaterThanOrEqual(dailyOnly);
  });

  test('clearing it starts the held step', () => {
    const { harness, projectId, run } = heldAtPace({ project: -1 });
    const project = harness.state.projects[projectId];
    if (!project) throw new Error('no project');
    harness.send({ type: 'project.write', project: { ...project, usageLimit: null } });
    expect(harness.state.projects[projectId]?.usageLimit).toBeUndefined();
    expect(isHeldStepStarted(harness, run.id)).toBe(true);
  });

  test('is above zero, only you change it, and an agent may write the project without touching it', () => {
    const { harness, projectId } = heldAtPace({ project: 50 });
    const project = harness.state.projects[projectId];
    if (!project) throw new Error('no project');
    expect(() => harness.send({ type: 'project.write', project: { ...project, usageLimit: -2 } })).toThrow(
      'The usage limit must be above zero.'
    );
    expect(() =>
      harness.send({ type: 'project.write', project: { ...project, usageLimit: 3 } }, { onBehalf: true })
    ).toThrow('Only the human changes a project’s usage limit. Tell them what you would change and why.');
    harness.send(
      { type: 'project.write', project: { ...project, description: 'The paywall editor' } },
      { onBehalf: true }
    );
    expect(harness.state.projects[projectId]).toMatchObject({
      description: 'The paywall editor',
      usageLimit: project.usageLimit,
    });
    const { usageLimit: _kept, ...withoutLimit } = project;
    harness.send({ type: 'project.write', project: { ...withoutLimit, description: 'Paywalls' } });
    expect(harness.state.projects[projectId]?.usageLimit).toBe(project.usageLimit);
  });
});
