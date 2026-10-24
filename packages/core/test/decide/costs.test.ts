import { describe, expect, test } from 'bun:test';
import { isOverBudget, listOpenGates, type RunUsage, resolveTaskCost } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan } from '../harness.ts';

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
    expect(harness.activeRun(taskId).role).toBe('planner');
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ purpose: 'failure', cause: 'budget', title: 'Reached its cost limit' });
    expect(gate.body).toBe(
      'This task has used $6.00, past its $5.00 limit, so the next step did not start. Continue to allow another $5.00, or cancel the task.'
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
    expect(harness.activeRun(taskId).role).toBe('builder');
    meter(harness, taskId, 4);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('raising the limit releases tasks it paused', () => {
    const { harness, taskId } = limited(5);
    meter(harness, taskId, 6);
    proposePlan(harness, taskId);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 20 } });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.activeRun(taskId).role).toBe('builder');
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
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
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
      'The cost limit must be an amount above zero, or off.'
    );
  });
});

function meterWeekly(harness: Harness, taskId: string, weeklyPercent: number, sessionId?: string) {
  return harness.send({
    type: 'run.meter',
    runId: harness.activeRun(taskId).id,
    usage: usage(0.1),
    weeklyPercent,
    ...(sessionId ? { sessionId } : {}),
  });
}

function limitedByUsage(percent: number) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { taskUsageLimit: percent } });
  const taskId = createTask(harness);
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
  test('adds each measured share to the run, and a share of nothing records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    meterWeekly(harness, taskId, 1.5);
    meterWeekly(harness, taskId, 2);
    expect(harness.state.runs[runId]?.weeklyPercent).toBe(3.5);
    meterWeekly(harness, taskId, 0);
    expect(harness.state.runs[runId]?.weeklyPercent).toBe(3.5);
  });

  test('a session that reports the same totals still records the weekly usage it measured', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    meterWeekly(harness, taskId, 1, 's1');
    expect(meterWeekly(harness, taskId, 0, 's1').events).toEqual([]);
    expect(meterWeekly(harness, taskId, 2, 's1').events).toHaveLength(1);
    expect(harness.state.runs[runId]).toMatchObject({ weeklyPercent: 3, usage: { costUsd: 0.1 } });
  });

  test('a share outside 0 to 100 is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() => meterWeekly(harness, taskId, -1)).toThrow(
      'The weekly usage a run used must be a percentage from 0 to 100.'
    );
    expect(() => meterWeekly(harness, taskId, 101)).toThrow('from 0 to 100');
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
    expect(gate).toMatchObject({ purpose: 'failure', cause: 'budget', title: 'Reached its usage limit' });
    expect(gate.body).toBe(
      'This task has used 12% of the weekly usage limit, past its 10% limit, so the next step did not start. Continue to allow another 10%, or cancel the task.'
    );
  });

  test('continuing allows another share of the weekly limit', () => {
    const { harness, taskId } = limitedByUsage(10);
    meterWeekly(harness, taskId, 12);
    proposePlan(harness, taskId);
    answerGate(harness, taskId);
    expect(harness.task(taskId).usageAcknowledgedPercent).toBe(12);
    expect(harness.task(taskId).budgetAcknowledgedUsd).toBeUndefined();
    expect(harness.activeRun(taskId).role).toBe('builder');
  });

  test('continuing past both limits allows another of each', () => {
    const { harness, taskId } = limitedByUsage(10);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 1 } });
    harness.send({
      type: 'run.meter',
      runId: harness.activeRun(taskId).id,
      usage: usage(2),
      weeklyPercent: 11,
    });
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId).title).toBe('Reached its usage limit');
    answerGate(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({ usageAcknowledgedPercent: 11, budgetAcknowledgedUsd: 2 });
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

  test('the limit must be a whole percentage from 1 to 100', () => {
    const harness = createHarness();
    for (const taskUsageLimit of [0, 101, 2.5]) {
      expect(() => harness.send({ type: 'settings.change', patch: { taskUsageLimit } })).toThrow(
        'The usage limit must be a whole percentage from 1 to 100, or off.'
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
      ['builder', 0.4],
      ['reviewer', 0.7],
    ]);
    expect(isOverBudget(harness.state, task)).toBe(true);
  });
});
