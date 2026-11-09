import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  NO_FOCUS_PROJECTS,
  type Repo,
  type Round,
  type Run,
  type RunUsage,
  resolveCacheHitRate,
  resolveProjectStatsSource,
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

  test('a merged round without an end time is dated when its task closed or changed stage, and its task counts as finished', () => {
    const closed = task('a', { stage: 'done', closedAt: DAY, rounds: [round(1, { endedAt: null })] });
    const open = task('b', {
      stage: 'shipping',
      closedAt: null,
      stageChangedAt: 2 * DAY,
      rounds: [round(1, { endedAt: null })],
    });
    const stats = resolveStats(stateOf([closed, open], []), windowOf(3));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 1, 1]);
    expect(stats.days.map((day) => day.tasks)).toEqual([0, 1, 1]);
  });

  test('a cancelled task keeps its merged pull request but does not count as finished', () => {
    const cancelled = task('a', { stage: 'cancelled', closedAt: DAY, rounds: [round(1, { endedAt: DAY })] });
    const stats = resolveStats(stateOf([cancelled], []), windowOf(3));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 1, 0]);
    expect(stats.total.tasks).toBe(0);
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
  test('a pull request counts on the day it merged, even when its round ended later', () => {
    const merged = task('a', {
      stage: 'merged',
      closedAt: null,
      stageChangedAt: 3 * DAY,
      rounds: [
        round(1, {
          endedAt: 2 * DAY,
          pullRequest: { number: 7, url: 'u', state: 'merged', base: null, mergedAt: DAY + 5 },
        }),
      ],
    });
    const stats = resolveStats(stateOf([merged], []), windowOf(4));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 1, 0, 0]);
    expect(stats.days.map((day) => day.tasks)).toEqual([0, 1, 0, 0]);
  });

  test('a task counts as finished on the day it first merged, not when it closed or a later round ended', () => {
    const merged = { number: 7, url: 'u', state: 'merged' as const, base: null, mergedAt: DAY };
    const closedLater = task('a', {
      stage: 'done',
      closedAt: 3 * DAY,
      rounds: [round(1, { endedAt: DAY, pullRequest: merged })],
    });
    const laterRound = task('b', {
      stage: 'done',
      closedAt: 3 * DAY,
      rounds: [
        round(1, { endedAt: DAY, pullRequest: { ...merged, number: 8 } }),
        round(2, { status: 'finished', endedAt: 2 * DAY, pullRequest: null }),
      ],
    });
    const unmerged = task('c', {
      stage: 'done',
      closedAt: 3 * DAY,
      rounds: [round(1, { status: 'finished', endedAt: 2 * DAY, pullRequest: null })],
    });
    const stats = resolveStats(stateOf([closedLater, laterRound, unmerged], []), windowOf(4));
    expect(stats.days.map((day) => day.tasks)).toEqual([0, 2, 1, 0]);
  });

  test('a merged pull request still counts while its round is reopened or after it finished another way', () => {
    const merged = { number: 7, url: 'u', state: 'merged' as const, base: null, mergedAt: DAY };
    const watching = task('a', {
      rounds: [round(1, { status: 'active', endedAt: DAY, pullRequest: merged })],
    });
    const operated = task('b', {
      rounds: [round(1, { status: 'finished', pullRequest: { ...merged, number: 8 } })],
    });
    const unmerged = task('c', { rounds: [round(1, { status: 'finished' })] });
    const stats = resolveStats(stateOf([watching, operated, unmerged], []), windowOf(3));
    expect(stats.days.map((day) => day.pullRequests)).toEqual([0, 2, 0]);
  });

  test('a watchdog check on a later day leaves every shipping count where it was', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ state: 'merged', changes: { additions: 3, deletions: 1, changedFiles: 1 } }),
    });
    const mergeDay = Math.floor(harness.now / DAY);
    const window: StatsWindow = {
      days: ['merge', 'later'],
      dayOf: (at) => (Math.floor(at / DAY) === mergeDay ? 'merge' : 'later'),
    };
    const before = resolveStats(harness.state, window);
    harness.advance(DAY);
    harness.replay({ type: 'task.staged', taskId, stage: 'watching', reason: 'Watch check' });
    expect(resolveStats(harness.state, window).days).toEqual(before.days);
    harness.replay({ type: 'task.staged', taskId, stage: 'answering', reason: 'Follow-up' });
    expect(resolveStats(harness.state, window).days).toEqual(before.days);
    harness.replay({ type: 'task.staged', taskId, stage: 'merged', reason: 'Watch check done' });
    expect(harness.task(taskId).stageChangedAt).toBeGreaterThan((mergeDay + 1) * DAY);
    const after = resolveStats(harness.state, window);
    expect(after.days).toEqual(before.days);
    expect(after.days[0]).toMatchObject({ pullRequests: 1, tasks: 1, additions: 3 });
    expect(after.streak).toEqual(before.streak);
  });
});

describe('cache rates', () => {
  test('share of prompt tokens read from the cache, none without a prompt', () => {
    const line = {
      runs: 1,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
      tokens: 510,
      knownUsd: 0,
    };
    expect(Option.getOrNull(resolveCacheHitRate(line))).toBe(0.6);
    const empty = { ...line, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(Option.getOrNull(resolveCacheHitRate(empty))).toBeNull();
  });
});

describe('resolveProjectStatsSource', () => {
  const repo: Repo = {
    id: 'repo-a',
    name: 'a',
    path: '/a',
    defaultBranch: 'main',
    remote: null,
    projectId: 'project-a',
    checkCommands: [],
  };
  const source = {
    ...stateOf(
      [
        task('own', { projectId: 'project-a', repoId: null }),
        task('by-repo', { projectId: null, repoId: 'repo-a' }),
        task('other', { projectId: 'project-b', repoId: null }),
        task('loose', { projectId: null, repoId: null }),
      ],
      [run('r-own', 'own'), run('r-by-repo', 'by-repo'), run('r-other', 'other'), run('r-gone', 'gone')]
    ),
    repos: { [repo.id]: repo },
  };

  test('no project keeps every task and run', () => {
    const scoped = resolveProjectStatsSource(source, NO_FOCUS_PROJECTS);
    expect(scoped.tasks).toBe(source.tasks);
    expect(scoped.runs).toBe(source.runs);
  });

  test('a project keeps its tasks, by their own project or their repository, and only their runs', () => {
    const scoped = resolveProjectStatsSource(source, { projectIds: ['project-a'], except: false });
    expect(Object.keys(scoped.tasks).sort()).toEqual(['by-repo', 'own']);
    expect(Object.keys(scoped.runs).sort()).toEqual(['r-by-repo', 'r-own']);
  });

  test('several projects keep the tasks of each, and all but a project keeps everything else', () => {
    const both = resolveProjectStatsSource(source, { projectIds: ['project-a', 'project-b'], except: false });
    expect(Object.keys(both.tasks).sort()).toEqual(['by-repo', 'other', 'own']);
    const allBut = resolveProjectStatsSource(source, { projectIds: ['project-a'], except: true });
    expect(Object.keys(allBut.tasks).sort()).toEqual(['loose', 'other']);
    expect(Object.keys(allBut.runs)).toEqual(['r-other']);
  });
});
