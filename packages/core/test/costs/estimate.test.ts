import { describe, expect, test } from 'bun:test';
import {
  BUILD_ESTIMATE_LIMITS,
  DEFAULT_BUILD_COSTS,
  type PhaseStatus,
  resolveBuildEstimate,
  type Run,
  type Task,
} from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  learnUsageRate,
  PLAN,
  proposePlan,
  writePastRun,
} from '../harness.ts';

interface Shape {
  phases: number;
  files?: number;
  checks?: number;
  done?: number;
  status?: PhaseStatus;
}

function createPlanned(harness: Harness) {
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return harness.task(taskId);
}

function writeTask(harness: Harness, base: Task, id: string, shape: Shape) {
  const { phases, files = 0, checks = 1, done = 0, status = 'done' } = shape;
  const document = base.plan?.document ?? PLAN;
  const task: Task = {
    ...base,
    id,
    rounds: undefined,
    plan: {
      ...(base.plan as NonNullable<Task['plan']>),
      document: {
        ...document,
        phases: Array.from({ length: phases }, (_, index) => ({
          title: `Phase ${index + 1}`,
          detail: 'Do it.',
        })),
        files: Array.from({ length: files }, (_, index) => ({
          path: `src/${index}.ts`,
          change: 'Change it.',
        })),
        verification: Array.from({ length: checks }, (_, index) => ({
          label: `Check ${index}`,
          command: 'bun test src',
          phases: [1],
        })),
      },
    },
    phases: Array.from({ length: phases }, (_, index) => ({
      status: index < done ? status : 'pending',
      at: 1,
    })),
  };
  harness.state.tasks = { ...harness.state.tasks, [id]: task };
  return task;
}

function writeBuildRun(
  harness: Harness,
  taskId: string,
  costUsd: number | null,
  overrides: Partial<Run> = {}
) {
  const id = `${taskId}-run-${Object.keys(harness.state.runs).length}`;
  harness.state.runs = {
    ...harness.state.runs,
    [id]: {
      id,
      taskId,
      role: 'agent',
      purpose: 'build',
      provider: 'claude',
      model: null,
      sessionId: null,
      startedAt: 10,
      endedAt: 20,
      outcome: 'completed',
      summary: null,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd },
      ...overrides,
    },
  };
}

function writeFinished(harness: Harness, base: Task, id: string, phases: number, usdPerPhase: number) {
  writeTask(harness, base, id, { phases, done: phases });
  writeBuildRun(harness, id, usdPerPhase * phases);
}

describe('resolveBuildEstimate', () => {
  test('a task without a plan to build has no estimate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(resolveBuildEstimate(harness.state, harness.task(taskId))).toBeNull();
  });

  test('without enough past builds it uses the measured cost per phase for a plan of its size', () => {
    const harness = createHarness();
    const base = createPlanned(harness);
    const small = writeTask(harness, base, 'small', { phases: 2 });
    const huge = writeTask(harness, base, 'huge', { phases: 12 });
    const [perSmall] = DEFAULT_BUILD_COSTS.usdPerPhase.slice(1);
    const perHuge = DEFAULT_BUILD_COSTS.usdPerPhase.at(-1) as number;
    expect(resolveBuildEstimate(harness.state, small)).toEqual({
      phases: 2,
      donePhases: 0,
      usd: (perSmall as number) * 2,
      spentUsd: 0,
      remainingUsd: (perSmall as number) * 2,
      percent: null,
      remainingPercent: null,
      samples: 0,
      trusted: false,
    });
    expect(resolveBuildEstimate(harness.state, huge)?.usd).toBeCloseTo(perHuge * 12);
  });

  test('turns the cost into a share of the weekly limit at the learned rate', () => {
    const harness = createHarness();
    learnUsageRate(harness);
    const task = writeTask(harness, createPlanned(harness), 'target', { phases: 1 });
    const estimate = resolveBuildEstimate(harness.state, task);
    expect(estimate?.percent).toBeCloseTo(DEFAULT_BUILD_COSTS.usdPerPhase[0]);
    expect(estimate?.trusted).toBe(true);
  });

  test('takes the 70th percentile of the past builds nearest the plan, leaving out the task itself', () => {
    const harness = createHarness();
    const base = createPlanned(harness);
    for (let index = 1; index <= BUILD_ESTIMATE_LIMITS.neighbours; index += 1) {
      writeFinished(harness, base, `near-${index}`, 2, index);
    }
    for (let index = 0; index < 5; index += 1) writeFinished(harness, base, `far-${index}`, 8, 100);
    const target = writeTask(harness, base, 'near-1', { phases: 2 });
    const estimate = resolveBuildEstimate(harness.state, target);
    expect(estimate?.samples).toBe(BUILD_ESTIMATE_LIMITS.neighbours);
    expect(estimate?.usd).toBe(15 * 2);
  });

  test('a past build is a sample only once it is finished, priced and has cost something', () => {
    const harness = createHarness();
    const base = createPlanned(harness);
    writeFinished(harness, base, 'priced', 2, 5);
    writeFinished(harness, base, 'free', 2, 0);
    writeTask(harness, base, 'unpriced', { phases: 2, done: 2 });
    writeBuildRun(harness, 'unpriced', null);
    writeTask(harness, base, 'unfinished', { phases: 2, done: 1 });
    writeBuildRun(harness, 'unfinished', 50);
    writeTask(harness, base, 'skipped', { phases: 2, done: 2, status: 'skipped' });
    writeBuildRun(harness, 'skipped', 6, { role: 'reviewer', purpose: undefined });
    writeBuildRun(harness, 'skipped', 1000, { purpose: 'plan' });
    writeBuildRun(harness, 'skipped', 1000, { round: 2 });
    writeBuildRun(harness, 'skipped', 1000, { usage: undefined });
    const target = writeTask(harness, base, 'target', { phases: 2 });
    expect(resolveBuildEstimate(harness.state, target)?.samples).toBe(0);
    writeFinished(harness, base, 'third', 2, 4);
    const estimate = resolveBuildEstimate(harness.state, target);
    expect(estimate?.samples).toBe(3);
    expect(estimate?.usd).toBe(5 * 2);
  });

  test('before a phase is done it subtracts what the build has spent, and never goes below nothing', () => {
    const harness = createHarness();
    const base = createPlanned(harness);
    const perPhase = DEFAULT_BUILD_COSTS.usdPerPhase[1];
    const started = writeTask(harness, base, 'started', { phases: 2 });
    writeBuildRun(harness, 'started', 2);
    expect(resolveBuildEstimate(harness.state, started)?.remainingUsd).toBeCloseTo(perPhase * 2 - 2);
    writeBuildRun(harness, 'started', 100);
    const over = resolveBuildEstimate(harness.state, started);
    expect(over?.remainingUsd).toBe(0);
    expect(over?.usd).toBe(102);
  });

  test('after each phase it corrects the rest from what the finished phases cost', () => {
    const harness = createHarness();
    const base = createPlanned(harness);
    const perPhase = DEFAULT_BUILD_COSTS.usdPerPhase[2];
    const halfway = writeTask(harness, base, 'halfway', { phases: 3, done: 1 });
    writeBuildRun(harness, 'halfway', 20);
    const corrected = (perPhase + 20) / 2;
    expect(resolveBuildEstimate(harness.state, halfway)).toMatchObject({
      donePhases: 1,
      spentUsd: 20,
      remainingUsd: 2 * corrected,
      usd: 20 + 2 * corrected,
    });
    const finished = writeTask(harness, base, 'halfway', { phases: 3, done: 3 });
    expect(resolveBuildEstimate(harness.state, finished)).toMatchObject({ remainingUsd: 0, usd: 20 });
  });

  test('reads the rate of the account the task runs on, else the best rate there is', () => {
    const harness = createHarness();
    learnUsageRate(harness);
    for (let index = 0; index < 6; index += 1) {
      writePastRun(harness, {
        id: `slow-${index}`,
        taskId: `slow-${index}`,
        from: index * 1_000,
        percent: 0,
        costUsd: 4,
      });
      const run = harness.state.runs[`slow-${index}`] as Run;
      const meter = run.meters?.[0] as NonNullable<Run['meters']>[number];
      harness.state.runs = {
        ...harness.state.runs,
        [run.id]: {
          ...run,
          meters: [
            {
              ...meter,
              window: 'account:acc-2',
              readings: meter.readings.map((reading) => ({ ...reading, percent: reading.percent / 10 })),
            },
          ],
        },
      };
    }
    const base = createPlanned(harness);
    const perPhase = DEFAULT_BUILD_COSTS.usdPerPhase[0];
    const free = writeTask(harness, base, 'free', { phases: 1 });
    expect(resolveBuildEstimate(harness.state, free)).toMatchObject({ trusted: true });
    expect(resolveBuildEstimate(harness.state, free)?.percent).toBeCloseTo(perPhase);
    const bound = {
      ...writeTask(harness, base, 'bound', { phases: 1 }),
      account: { id: 'acc-2', email: null },
    };
    harness.state.tasks = { ...harness.state.tasks, bound };
    expect(resolveBuildEstimate(harness.state, bound)).toMatchObject({ trusted: false });
    expect(resolveBuildEstimate(harness.state, bound)?.percent).toBeCloseTo(perPhase * 0.05);
    const ran = writeTask(harness, base, 'ran', { phases: 1 });
    const slow = harness.state.runs['slow-0'] as Run;
    writeBuildRun(harness, 'ran', 0, { startedAt: 5, meters: slow.meters });
    writeBuildRun(harness, 'ran', 0, { startedAt: 1 });
    writeBuildRun(harness, 'ran', 0, { startedAt: 2, meters: harness.state.runs['learned-0']?.meters });
    expect(resolveBuildEstimate(harness.state, ran)?.trusted).toBe(false);
    const unknown = {
      ...writeTask(harness, base, 'unknown', { phases: 1 }),
      account: { id: 'acc-9', email: null },
    };
    expect(resolveBuildEstimate(harness.state, unknown)?.trusted).toBe(true);
  });
});
