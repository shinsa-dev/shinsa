import { describe, expect, test } from 'bun:test';
import {
  createState,
  HOUR_MS,
  listRecentSpends,
  RECENT_USAGE_MS,
  type Run,
  type RunMeter,
  resolveRecentUsage,
  resolveRecentUsageFreesAt,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';

const NOW = 100 * HOUR_MS;
const WORK = 'account:work';

function createMeter(id: string, window: string, endsAgoHours: number, costUsd: number | null): RunMeter {
  const to = NOW - endsAgoHours * HOUR_MS;
  const from = to - HOUR_MS;
  return {
    attemptId: id,
    window,
    from,
    to,
    usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd },
    readings:
      costUsd === null
        ? []
        : [
            { percent: 0, at: from, resetsAt: null },
            { percent: costUsd * 10, at: to, resetsAt: null },
          ],
  };
}

function createRun(id: string, taskId: string, meters: RunMeter[]): Run {
  return {
    id,
    taskId,
    role: 'agent',
    purpose: 'build',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: meters[0]?.from ?? 0,
    endedAt: meters.at(-1)?.to ?? null,
    outcome: 'completed',
    summary: null,
    meters,
  };
}

function createUsageState(runs: Run[]): ShinsaState {
  const state = createState();
  state.tasks = {
    app: { id: 'app', projectId: 'project-app' } as Task,
    site: { id: 'site', projectId: 'project-site' } as Task,
  };
  state.runs = Object.fromEntries(runs.map((run) => [run.id, run]));
  return state;
}

const STATE = createUsageState([
  createRun('old', 'app', [createMeter('old', WORK, 30, 1)]),
  createRun('app-early', 'app', [createMeter('app-early', WORK, 20, 1)]),
  createRun('site', 'site', [createMeter('site', WORK, 10, 2)]),
  createRun('app-late', 'app', [
    createMeter('app-late', WORK, 2, 0.5),
    createMeter('loose', 'account:new', 1, null),
  ]),
  createRun('lost', 'gone', [createMeter('lost', WORK, 3, 0.1)]),
  createRun('future', 'app', [createMeter('future', WORK, -1, 1)]),
  createRun('bare', 'app', []),
  { ...createRun('unmetered', 'app', []), meters: undefined },
]);

describe('resolveRecentUsage', () => {
  test('adds up what each step cost of the weekly limit over the last day', () => {
    const recent = resolveRecentUsage(STATE, NOW);
    expect(recent.from).toBe(NOW - RECENT_USAGE_MS);
    expect(recent.to).toBe(NOW);
    expect(recent.percent).toBeCloseTo(36, 6);
    expect(recent.unmetered).toBe(1);
    expect(recent.spends.map((spend) => spend.taskId)).toEqual(['app', 'site', 'gone', 'app']);
    expect(recent.spends[2]?.projectId).toBeNull();
    expect(recent.spends[0]?.window).toBe(WORK);
  });

  test('counts one project alone', () => {
    expect(resolveRecentUsage(STATE, NOW, 'project-app').percent).toBeCloseTo(15, 6);
    expect(resolveRecentUsage(STATE, NOW, 'project-site').percent).toBeCloseTo(20, 6);
    expect(resolveRecentUsage(STATE, NOW, 'project-none').percent).toBe(0);
  });

  test('skips a meter on a window it has not learned yet', () => {
    expect(listRecentSpends(STATE, NOW).unmetered).toBe(1);
  });
});

describe('resolveRecentUsageFreesAt', () => {
  test('frees once enough of the oldest usage leaves the window', () => {
    const recent = resolveRecentUsage(STATE, NOW);
    expect(resolveRecentUsageFreesAt(recent, 40)).toBeNull();
    expect(resolveRecentUsageFreesAt(recent, 30)).toBe(NOW - 20 * HOUR_MS + RECENT_USAGE_MS);
    expect(resolveRecentUsageFreesAt(recent, 10)).toBe(NOW - 10 * HOUR_MS + RECENT_USAGE_MS);
  });

  test('frees when the last usage leaves a window that never goes under the limit', () => {
    const recent = resolveRecentUsage(STATE, NOW, 'project-app');
    expect(resolveRecentUsageFreesAt(recent, 0)).toBe(NOW - 2 * HOUR_MS + RECENT_USAGE_MS);
    expect(resolveRecentUsageFreesAt(resolveRecentUsage(STATE, NOW, 'project-none'), 0)).toBeNull();
  });
});
