import { describe, expect, test } from 'bun:test';
import {
  describeBudgetAmount,
  describeUsd,
  describeWeeklyPercent,
  listTaskBudgets,
  type RunUsage,
  resolveTaskCost,
  resolveUsageDelta,
} from '../../src/index.ts';
import { buildAll, createHarness, createTask, PASSING } from '../harness.ts';

function usage(costUsd: number | null, input = 100, output = 10): RunUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: 5, cacheWriteTokens: 1, costUsd };
}

describe('resolveTaskCost', () => {
  test('rolls the runs up per task, per role and per phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId).id;
    harness.send({ type: 'run.meter', runId: planner, usage: usage(0.1) });
    buildAll(harness, taskId);
    const builders = Object.values(harness.state.runs).filter((run) => run.role === 'builder');
    for (const [index, run] of builders.entries()) {
      harness.send({ type: 'run.meter', runId: run.id, usage: usage(index === 0 ? 1 : null) });
    }
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const cost = resolveTaskCost(harness.state, harness.task(taskId));
    expect(cost.total).toEqual({
      runs: 3,
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 15,
      cacheWriteTokens: 3,
      tokens: 348,
      knownUsd: 1.1,
      unpricedRuns: 1,
      weeklyPercent: 0,
    });
    expect(cost.byRole.map((line) => [line.role, line.cost.runs])).toEqual([
      ['planner', 1],
      ['builder', 2],
    ]);
    expect(cost.byPhase.map((line) => [line.index, line.title, line.cost.knownUsd])).toEqual([
      [0, 'Find the overflow', 1],
      [1, 'Fix and verify', 0],
    ]);
  });

  test('a run that was not metered costs nothing and a phase without a plan has a plain name', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = harness.task(taskId);
    expect(resolveTaskCost(harness.state, task).total.runs).toBe(0);
    harness.state.runs.x = {
      ...harness.activeRun(taskId),
      id: 'x',
      role: 'builder',
      phaseIndex: 4,
      usage: usage(0.2),
    };
    expect(resolveTaskCost(harness.state, task).byPhase[0]?.title).toBe('Phase 5');
  });

  test('every role that ran shows in the cost per role, in the order the work happens', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    for (const role of ['operator', 'researcher', 'investigator', 'planner'] as const) {
      harness.state.runs[role] = { ...run, id: role, role, usage: usage(0.5) };
    }
    const cost = resolveTaskCost(harness.state, harness.task(taskId));
    expect(cost.byRole.map((line) => line.role)).toEqual([
      'planner',
      'investigator',
      'researcher',
      'operator',
    ]);
    expect(cost.byRole.reduce((sum, line) => sum + line.cost.knownUsd, 0)).toBe(cost.total.knownUsd);
  });
});

describe('listTaskBudgets', () => {
  test('is empty without a limit, and counts each limit from what you last allowed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({ type: 'run.meter', runId, usage: usage(4), weeklyPercent: 3 });
    expect(listTaskBudgets(harness.state, harness.task(taskId))).toEqual([]);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 5, taskUsageLimit: 12 } });
    expect(listTaskBudgets(harness.state, harness.task(taskId))).toEqual([
      { unit: 'percent', cap: 12, limit: 12, spent: 3, share: 0.25 },
      { unit: 'usd', cap: 5, limit: 5, spent: 4, share: 0.8 },
    ]);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: null } });
    expect(listTaskBudgets(harness.state, harness.task(taskId)).map((budget) => budget.unit)).toEqual([
      'percent',
    ]);
  });

  test('a run measured only by its weekly usage counts toward the usage limit', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { taskUsageLimit: 10 } });
    const taskId = createTask(harness);
    harness.state.runs.x = { ...harness.activeRun(taskId), id: 'x', usage: null, weeklyPercent: 4 };
    expect(resolveTaskCost(harness.state, harness.task(taskId)).total).toMatchObject({
      runs: 0,
      weeklyPercent: 4,
    });
  });
});

describe('describeUsd', () => {
  test('shows cents, and tiny amounts as under a cent', () => {
    expect(describeUsd(0)).toBe('$0.00');
    expect(describeUsd(0.004)).toBe('<$0.01');
    expect(describeUsd(12.345)).toBe('$12.35');
  });
});

describe('describeWeeklyPercent', () => {
  test('rounds to a whole percentage, and a sliver reads as under one percent', () => {
    expect(describeWeeklyPercent(0)).toBe('0%');
    expect(describeWeeklyPercent(0.4)).toBe('<1%');
    expect(describeWeeklyPercent(12.6)).toBe('13%');
    expect(describeBudgetAmount({ unit: 'percent' }, 10)).toBe('10%');
    expect(describeBudgetAmount({ unit: 'usd' }, 10)).toBe('$10.00');
  });
});

describe('resolveUsageDelta', () => {
  test('counts a fresh session in full, never goes below zero, and an unknown price stays unknown', () => {
    expect(resolveUsageDelta(null, usage(0.4, 40))).toEqual(usage(0.4, 40));
    expect(resolveUsageDelta(usage(0.5, 50, 50), usage(0.2, 10, 10))).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
    expect(resolveUsageDelta(usage(null), usage(0.2)).costUsd).toBeNull();
  });
});
