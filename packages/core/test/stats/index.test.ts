import { describe, expect, test } from 'bun:test';
import {
  type Round,
  type Run,
  type RunUsage,
  resolveCacheHitRate,
  resolveCacheWriteShare,
  resolveStats,
  type ShinsaState,
  type StatsWindow,
  type Task,
  UNKNOWN_MODEL,
} from '../../src/index.ts';
import { createHarness, createTask, pullRequest, reachShipping } from '../harness.ts';

const DAY = 86_400_000;

function windowOf(count: number): StatsWindow {
  return {
    days: Array.from({ length: count }, (_, index) => `d${index}`),
    dayOf: (at) => `d${Math.floor(at / DAY)}`,
  };
}

function usage(overrides: Partial<RunUsage> = {}): RunUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
    costUsd: 1,
    ...overrides,
  };
}

function baseTask(): Task {
  const harness = createHarness();
  return harness.task(createTask(harness));
}

const BASE = baseTask();

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { ...BASE, id, title: `Task ${id}`, handle: `LOC-${id}`, rounds: [], ...overrides };
}

function round(number: number, overrides: Partial<Round> = {}): Round {
  return {
    number,
    title: `Round ${number}`,
    request: 'r',
    why: null,
    shipping: 'onto_pull_request',
    status: 'merged',
    pipeline: [],
    branch: 'b',
    base: null,
    pullRequest: { number: 10 + number, url: 'u', state: 'merged', base: null },
    queuedAt: 0,
    startedAt: 0,
    endedAt: DAY,
    outcome: null,
    ...overrides,
  };
}

function run(id: string, taskId: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    taskId,
    role: 'agent',
    purpose: 'build',
    provider: 'claude',
    model: 'claude-opus-5-5',
    sessionId: null,
    startedAt: DAY,
    endedAt: DAY + 10,
    outcome: null,
    summary: null,
    usage: usage(),
    ...overrides,
  };
}

function stateOf(tasks: Task[], runs: Run[]): Pick<ShinsaState, 'tasks' | 'runs'> {
  return {
    tasks: Object.fromEntries(tasks.map((entry) => [entry.id, entry])),
    runs: Object.fromEntries(runs.map((entry) => [entry.id, entry])),
  };
}

describe('resolveStats', () => {
  test('an empty log gives empty days, no streak and no cache rate', () => {
    const stats = resolveStats(stateOf([], []), windowOf(3));
    expect(stats.days.map((day) => day.day)).toEqual(['d0', 'd1', 'd2']);
    expect(stats.total.pullRequests).toBe(0);
    expect(stats.total.usage.tokens).toBe(0);
    expect(stats.streak).toEqual({ current: 0, longest: 0 });
    expect(stats.cacheHitRate).toBeNull();
    expect(stats.tasks).toEqual([]);
    expect(stats.savings).toEqual([]);
  });

  test('a merged pull request counts once on its last day with the lines it changed', () => {
    const changes = { additions: 120, deletions: 30, changedFiles: 4 };
    const merged = task('a', {
      stage: 'merged',
      closedAt: 2 * DAY,
      rounds: [
        round(1, { endedAt: DAY, pullRequest: { number: 7, url: 'u', state: 'merged', base: null } }),
        round(2, {
          endedAt: 2 * DAY + 5,
          pullRequest: { number: 7, url: 'u', state: 'merged', base: null, changes },
        }),
        round(3, { endedAt: DAY + 5, pullRequest: { number: 7, url: 'u', state: 'merged', base: null } }),
        round(4, { status: 'shipped', pullRequest: { number: 8, url: 'u', state: 'open', base: null } }),
        round(5, { pullRequest: null }),
      ],
    });
    const stats = resolveStats(stateOf([merged], []), windowOf(4));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 0, 1, 0]);
    expect(stats.days[2]).toMatchObject({ tasks: 1, additions: 120, deletions: 30, changedFiles: 4 });
    expect(stats.total).toMatchObject({ pullRequests: 1, tasks: 1, additions: 120 });
  });

  test('a merged round without an end time is dated when its task closed or changed stage', () => {
    const closed = task('a', { stage: 'done', closedAt: DAY, rounds: [round(1, { endedAt: null })] });
    const open = task('b', {
      stage: 'shipping',
      closedAt: null,
      stageChangedAt: 2 * DAY,
      rounds: [round(1, { endedAt: null })],
    });
    const stats = resolveStats(stateOf([closed, open], []), windowOf(3));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 1, 1]);
    expect(stats.days.map((day) => day.tasks)).toEqual([0, 1, 0]);
  });

  test('work outside the window is left out', () => {
    const late = task('a', { stage: 'merged', closedAt: 9 * DAY, rounds: [round(1, { endedAt: 9 * DAY })] });
    const stats = resolveStats(
      stateOf([late], [run('r', 'a', { startedAt: 9 * DAY, endedAt: 9 * DAY })]),
      windowOf(2)
    );
    expect(stats.total.pullRequests).toBe(0);
    expect(stats.total.tasks).toBe(0);
    expect(stats.tasks).toEqual([]);
  });

  test('the streak counts shipping days up to today or yesterday, and the longest run', () => {
    const shippedOn = (days: number[]) =>
      task('a', { rounds: days.map((day, index) => round(index + 1, { endedAt: day * DAY })) });
    expect(resolveStats(stateOf([shippedOn([0, 1, 3, 4])], []), windowOf(5)).streak).toEqual({
      current: 2,
      longest: 2,
    });
    expect(resolveStats(stateOf([shippedOn([0, 1, 2, 4])], []), windowOf(6)).streak).toEqual({
      current: 1,
      longest: 3,
    });
    expect(resolveStats(stateOf([shippedOn([0, 1])], []), windowOf(5)).streak).toEqual({
      current: 0,
      longest: 2,
    });
  });

  test('tokens land on the day each meter ended, and what no meter holds lands when the run ended', () => {
    const metered = run('r', 'a', {
      startedAt: 0,
      endedAt: null,
      usage: usage({ inputTokens: 300, costUsd: 3 }),
      meters: [
        { attemptId: 'x', window: 'w', from: 0, to: 10, usage: usage({ costUsd: 1 }), readings: [] },
        { attemptId: 'y', window: 'w', from: DAY, to: DAY + 10, usage: usage({ costUsd: 1 }), readings: [] },
      ],
    });
    const whole = run('s', 'a', { meters: [], endedAt: 2 * DAY });
    const unmetered = run('t', 'a', { usage: null });
    const stats = resolveStats(stateOf([task('a')], [metered, whole, unmetered]), windowOf(3));
    expect(stats.days.map((day) => day.usage.tokens)).toEqual([1150, 1050, 1050]);
    expect(stats.days.map((day) => day.usage.runs)).toEqual([1, 0, 1]);
    expect(stats.total.usage).toEqual({
      runs: 2,
      inputTokens: 400,
      outputTokens: 150,
      cacheReadTokens: 2400,
      cacheWriteTokens: 300,
      tokens: 3250,
      knownUsd: 4,
    });
  });

  test('a run whose meters cover all its usage adds nothing more, and an unpriced run costs nothing', () => {
    const covered = run('r', 'a', {
      usage: usage({ costUsd: null }),
      meters: [
        { attemptId: 'x', window: 'w', from: 0, to: 0, usage: usage({ costUsd: null }), readings: [] },
      ],
    });
    const stats = resolveStats(stateOf([task('a')], [covered]), windowOf(2));
    expect(stats.days.map((day) => day.usage.tokens)).toEqual([1050, 0]);
    expect(stats.total.usage.knownUsd).toBe(0);
  });

  test('tokens break down by role, kind of work and model, the largest first', () => {
    const runs = [
      run('a1', 'a', { purpose: 'plan' }),
      run('a2', 'a', { purpose: 'build', usage: usage({ outputTokens: 5000 }) }),
      run('a3', 'a', { role: 'reviewer', purpose: undefined, model: null }),
    ];
    const stats = resolveStats(stateOf([task('a')], runs), windowOf(2));
    expect(stats.byRole.map((line) => [line.key, line.usage.runs])).toEqual([
      ['agent', 2],
      ['reviewer', 1],
    ]);
    expect(stats.byWork.map((line) => line.key)).toEqual(['build', 'plan', 'reviewer']);
    expect(stats.byModel.map((line) => [line.key, line.usage.runs])).toEqual([
      ['claude-opus-5-5', 2],
      [UNKNOWN_MODEL, 1],
    ]);
  });

  test('tasks rank by tokens, and a task gone from the log keeps its id as its title', () => {
    const runs = [
      run('a1', 'a'),
      run('b1', 'b', { usage: usage({ outputTokens: 9000 }) }),
      run('c1', 'c'),
      run('g1', 'gone'),
    ];
    const stats = resolveStats(stateOf([task('a'), task('b'), task('c')], runs), windowOf(2));
    expect(stats.tasks.map((entry) => entry.taskId)).toEqual(['b', 'a', 'c', 'gone']);
    expect(stats.tasks[0]).toMatchObject({ title: 'Task b', handle: 'LOC-b', cacheHitRate: 0.8 });
    expect(stats.tasks[3]).toMatchObject({ title: 'gone', handle: null });
    expect(stats.cacheHitRate).toBe(0.8);
  });

  test('the savings list flags cache misses, heavy cache writes, fresh sessions and compactions', () => {
    const big = {
      inputTokens: 150_000,
      outputTokens: 1000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 100_000,
    };
    const attempt = (attemptId: string, resumed: boolean) => ({
      attemptId,
      provider: 'claude',
      model: null,
      resumed,
      handoff: null,
      startedAt: DAY,
    });
    const runs = [
      run('w1', 'wasteful', { usage: usage(big) }),
      run('f1', 'fresh', { attempts: [attempt('x', false), attempt('y', true), attempt('z', false)] }),
      run('f2', 'fresh', {
        role: 'builder',
        delegation: { parentRunId: 'f1', depth: 1 } as Run['delegation'],
        attempts: [attempt('d', false)],
      }),
      run('c1', 'compacted', { compactions: ['one', 'two'] }),
      run('ok', 'fine', { compactions: ['one'], attempts: [attempt('o', false)] }),
    ];
    const tasks = ['wasteful', 'fresh', 'compacted', 'fine'].map((id) => task(id));
    const stats = resolveStats(stateOf(tasks, runs), windowOf(2));
    expect(stats.savings.map((saving) => [saving.kind, saving.task.taskId])).toEqual([
      ['cache_misses', 'wasteful'],
      ['cache_writes', 'wasteful'],
      ['fresh_sessions', 'fresh'],
      ['compactions', 'compacted'],
    ]);
    expect(stats.tasks.find((entry) => entry.taskId === 'fresh')?.freshSessions).toBe(1);
  });

  test('a fresh session counts against the task’s first one, even when that one fell before the range', () => {
    const attempt = (attemptId: string, startedAt: number) => ({
      attemptId,
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt,
    });
    const before = run('old', 'a', {
      startedAt: 5 * DAY,
      endedAt: 5 * DAY,
      attempts: [attempt('first', 5 * DAY), attempt('early-restart', 5 * DAY + 1)],
    });
    const inside = run('new', 'a', {
      startedAt: 10 * DAY,
      endedAt: 10 * DAY,
      attempts: [attempt('restart', 10 * DAY)],
    });
    const window = { days: ['d10', 'd11'], dayOf: (at: number) => `d${Math.floor(at / DAY)}` };
    const stats = resolveStats(stateOf([task('a')], [before, inside]), window);
    expect(stats.tasks[0]?.freshSessions).toBe(1);
    expect(stats.savings.map((saving) => saving.kind)).toEqual(['fresh_sessions']);
  });

  test('a real merge through the harness shows up as shipped', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ state: 'merged', changes: { additions: 3, deletions: 1, changedFiles: 1 } }),
    });
    const stats = resolveStats(harness.state, { days: ['all'], dayOf: () => 'all' });
    expect(stats.total).toMatchObject({ pullRequests: 1, tasks: 1, additions: 3, deletions: 1 });
  });
});

describe('cache rates', () => {
  test('share of prompt tokens read from or written to the cache, none without a prompt', () => {
    const line = {
      runs: 1,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
      tokens: 510,
      knownUsd: 0,
    };
    expect(resolveCacheHitRate(line)).toBe(0.6);
    expect(resolveCacheWriteShare(line)).toBe(0.2);
    const empty = { ...line, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(resolveCacheHitRate(empty)).toBeNull();
    expect(resolveCacheWriteShare(empty)).toBeNull();
  });
});
