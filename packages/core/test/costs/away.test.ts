import { describe, expect, test } from 'bun:test';
import {
  AWAY_LIMITS,
  DAY_MS,
  HOUR_MS,
  isAwayAt,
  resolveAwayHours,
  resolveNightShift,
  type TimingSpan,
} from '../../src/index.ts';
import { resolveNightShiftTold } from '../../src/prompts/night.ts';
import { createHarness, createTask, type Harness } from '../harness.ts';

const NOW = 20 * DAY_MS + 12 * HOUR_MS;

function nights(days: number, now = NOW, fromHour = 0, toHour = 8): Record<string, TimingSpan> {
  const today = Math.floor(now / DAY_MS);
  return Object.fromEntries(
    Array.from({ length: days }, (_, index) => {
      const day = (today - days + index) * DAY_MS;
      return [
        String(day + fromHour * HOUR_MS),
        { from: day + fromHour * HOUR_MS, to: day + toHour * HOUR_MS },
      ];
    })
  );
}

function daytime(days: number, now = NOW) {
  const today = Math.floor(now / DAY_MS);
  const presence: Record<string, number> = {};
  for (let day = today - days; day < today; day += 1) {
    for (let hour = 9; hour < 18; hour += 1) presence[String(day * 24 + hour)] = 2;
  }
  return presence;
}

const NIGHT_HOURS = [0, 1, 2, 3, 4, 5, 6, 7];

describe('away hours', () => {
  test('are learned from the time you were away, by the hour of the day', () => {
    expect(resolveAwayHours({ away: nights(10), presence: {} }, NOW)).toEqual({
      hours: NIGHT_HOURS,
      source: 'away',
    });
  });

  test('an hour counts only when at least half of it was away, on at least half of the days', () => {
    const half = nights(10, NOW, 0, 8.4);
    const rare = nights(2, NOW, 10, 11);
    const away = resolveAwayHours({ away: { ...half, ...rare }, presence: {} }, NOW);
    expect(away?.hours).toEqual(NIGHT_HOURS);
  });

  test('ignore time away from before the last 14 days and an open span runs to now', () => {
    const old = nights(5, NOW - 20 * DAY_MS, 12, 20);
    const open = { open: { from: NOW - HOUR_MS, to: null } };
    const away = resolveAwayHours({ away: { ...old, ...open, ...nights(4) }, presence: {} }, NOW);
    expect(away?.hours).toEqual(NIGHT_HOURS);
  });

  test('fall back to the hours you were not active when too few days were away', () => {
    const away = resolveAwayHours({ away: nights(AWAY_LIMITS.minDays - 1), presence: daytime(10) }, NOW);
    expect(away?.source).toBe('activity');
    expect(away?.hours).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23]);
  });

  test('are unknown with too little of either, and nothing is away then', () => {
    const away = resolveAwayHours({ away: nights(2), presence: daytime(2) }, NOW);
    expect(away).toBeNull();
    expect(isAwayAt(away, NOW)).toBe(false);
    expect(isAwayAt({ hours: [3], source: 'away' }, 21 * DAY_MS + 3.5 * HOUR_MS)).toBe(true);
    expect(isAwayAt({ hours: [3], source: 'away' }, 21 * DAY_MS + 4 * HOUR_MS)).toBe(false);
  });
});

function nightHarness(options: { autoPace?: boolean; pace?: number | null } = {}) {
  const harness = createHarness();
  harness.advance(NOW - harness.now);
  harness.send({ type: 'settings.change', patch: { autoPace: options.autoPace ?? true } });
  if (options.pace !== null) {
    harness.send({ type: 'usage.pace_recorded', provider: 'claude', pace: options.pace ?? 50 });
  }
  return harness;
}

function awayNow(harness: Harness) {
  Object.assign(harness.state.away, nights(10));
  harness.advance(Math.floor(harness.now / DAY_MS) * DAY_MS + 26 * HOUR_MS - harness.now);
}

function shiftOf(harness: Harness, purpose: 'plan' | 'build' | 'fix' | 'operate', role = 'agent' as const) {
  const taskId = createTask(harness);
  return resolveNightShift(harness.state, harness.task(taskId), role, purpose, harness.now);
}

describe('the night shift', () => {
  test('is off without Auto pace, and only ever for the task’s agent', () => {
    const off = nightHarness({ autoPace: false });
    awayNow(off);
    expect(shiftOf(off, 'build')).toBeNull();
    const on = nightHarness();
    awayNow(on);
    const taskId = createTask(on);
    expect(resolveNightShift(on.state, on.task(taskId), 'reviewer', 'build', on.now)).toBeNull();
    expect(shiftOf(on, 'operate')).toBeNull();
  });

  test('tells a build or a fix while you are away to decide instead of asking', () => {
    const harness = nightHarness();
    expect(shiftOf(harness, 'build')).toBeNull();
    awayNow(harness);
    expect(shiftOf(harness, 'build')).toBe('night');
    expect(shiftOf(harness, 'fix')).toBe('night');
    const taskId = createTask(harness);
    expect(
      resolveNightShiftTold(harness.state, harness.task(taskId), 'agent', 'build', harness.now)
    ).toContain('Do not stop to ask');
  });

  test('tells planning to ask everything now when the build will wait', () => {
    const room = nightHarness();
    expect(shiftOf(room, 'plan')).toBeNull();
    expect(shiftOf(nightHarness({ pace: null }), 'plan')).toBeNull();
    expect(shiftOf(nightHarness({ pace: 0 }), 'plan')).toBe('unattended');
    const away = nightHarness();
    awayNow(away);
    expect(shiftOf(away, 'plan')).toBe('unattended');
    const queued = nightHarness();
    const waiting = createTask(queued);
    queued.state.tasks[waiting] = {
      ...queued.task(waiting),
      usageWait: {
        ...({} as NonNullable<ReturnType<Harness['task']>['usageWait']>),
        status: 'armed',
        pace: { scope: 'admission' } as never,
      },
    };
    expect(shiftOf(queued, 'plan')).toBe('unattended');
    expect(resolveNightShiftTold(queued.state, queued.task(waiting), 'agent', 'plan', queued.now)).toBe('');
  });

  test('reaches the agent at the end of its turn', () => {
    const harness = nightHarness({ pace: 0 });
    const taskId = createTask(harness);
    expect(harness.activeRun(taskId).prompt).toContain('Ask every question the build needs now');
    expect(harness.activeRun(taskId).rolePrompt).not.toContain('Ask every question');
  });
});
