import { describe, expect, test } from 'bun:test';
import {
  describeBudgetAmount,
  describeUsd,
  describeWeeklyPercent,
  listTaskBudgets,
  type RunMeter,
  type RunUsage,
  resolveCostUnit,
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
    const builders = Object.values(harness.state.runs).filter((run) => run.purpose === 'build');
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
      weeklyRuns: 0,
      weeklyTasks: 0,
      learningRuns: 0,
      estimatedPercent: 0,
    });
    expect(cost.byRole.map((line) => [line.role, line.cost.runs])).toEqual([['agent', 3]]);
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
      role: 'agent',
      purpose: 'build',
      phaseIndex: 4,
      usage: usage(0.2),
    };
    expect(resolveTaskCost(harness.state, task).byPhase[0]?.title).toBe('Phase 5');
  });

  test('every role that ran shows in the cost per role, in the order the work happens', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    for (const role of ['reviewer', 'researcher', 'investigator', 'agent'] as const) {
      harness.state.runs[role] = { ...run, id: role, role, usage: usage(0.5) };
    }
    const cost = resolveTaskCost(harness.state, harness.task(taskId));
    expect(cost.byRole.map((line) => line.role)).toEqual(['agent', 'investigator', 'researcher', 'reviewer']);
    expect(cost.byRole.reduce((sum, line) => sum + line.cost.knownUsd, 0)).toBe(cost.total.knownUsd);
  });
});

function meterOnAccount(harness: ReturnType<typeof createHarness>, taskId: string, count: number) {
  const run = harness.activeRun(taskId);
  harness.state.runs = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const from = index * 1_000;
      const id = `learned-${index}`;
      const meter: RunMeter = {
        attemptId: id,
        window: 'account:acc-1',
        from,
        to: from + 100,
        usage: usage(10),
        readings: [
          { percent: 40 + index * 2, at: from, resetsAt: null },
          { percent: 42 + index * 2, at: from + 100, resetsAt: null },
        ],
      };
      const taskOf = index === 0 ? taskId : `other-${index}`;
      return [
        id,
        {
          ...run,
          id,
          taskId: taskOf,
          status: undefined,
          endedAt: from + 100,
          usage: usage(10),
          meters: [meter],
        },
      ];
    })
  );
}

describe('listTaskBudgets', () => {
  test('is empty without a limit, and counts each limit from what you last allowed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    meterOnAccount(harness, taskId, 5);
    expect(listTaskBudgets(harness.state, harness.task(taskId))).toEqual([]);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 12.5, taskUsageLimit: 8 } });
    expect(listTaskBudgets(harness.state, harness.task(taskId))).toEqual([
      {
        unit: 'percent',
        cap: 8,
        limit: 8,
        spent: expect.closeTo(2, 9),
        share: expect.closeTo(0.25, 9),
        estimated: false,
      },
      { unit: 'usd', cap: 12.5, limit: 12.5, spent: 10, share: 0.8, estimated: false },
    ]);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: null } });
    expect(listTaskBudgets(harness.state, harness.task(taskId)).map((budget) => budget.unit)).toEqual([
      'percent',
    ]);
  });

  test('while the account is learning, the usage limit counts the early estimate and the cost limit dollars', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    meterOnAccount(harness, taskId, 2);
    harness.send({ type: 'settings.change', patch: { taskBudgetUsd: 12.5, taskUsageLimit: 8 } });
    expect(resolveTaskCost(harness.state, harness.task(taskId)).total).toMatchObject({
      weeklyPercent: 0,
      weeklyRuns: 0,
      learningRuns: 1,
      estimatedPercent: expect.closeTo(2, 9),
    });
    expect(listTaskBudgets(harness.state, harness.task(taskId))).toEqual([
      expect.objectContaining({ unit: 'percent', spent: expect.closeTo(2, 9), estimated: true }),
      expect.objectContaining({ unit: 'usd', spent: 10, estimated: false }),
    ]);
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
  test('shows a tenth below ten percent, whole percentages above, and a sliver as under a tenth', () => {
    expect(describeWeeklyPercent(0)).toBe('0%');
    expect(describeWeeklyPercent(0.04)).toBe('<0.1%');
    expect(describeWeeklyPercent(0.44)).toBe('0.4%');
    expect(describeWeeklyPercent(2)).toBe('2%');
    expect(describeWeeklyPercent(9.96)).toBe('10%');
    expect(describeWeeklyPercent(12.6)).toBe('13%');
    expect(describeBudgetAmount({ unit: 'percent' }, 10)).toBe('10%');
    expect(describeBudgetAmount({ unit: 'usd' }, 10)).toBe('$10.00');
  });
});

describe('resolveCostUnit', () => {
  test('is the weekly window once every priced run has a share of one, else dollars', () => {
    const harness = createHarness();
    const line = resolveTaskCost(harness.state, harness.task(createTask(harness))).total;
    expect(resolveCostUnit(line)).toBe('usd');
    expect(resolveCostUnit({ ...line, runs: 1, weeklyRuns: 1 })).toBe('percent');
    expect(resolveCostUnit({ ...line, runs: 2, weeklyRuns: 1, unpricedRuns: 1 })).toBe('percent');
    expect(resolveCostUnit({ ...line, runs: 2, weeklyRuns: 1, learningRuns: 1 })).toBe('usd');
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
