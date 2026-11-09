import { describe, expect, test } from 'bun:test';
import { DAY_MS, HOUR_MS, resolveNightShift, type TimingSpan } from '../../src/index.ts';
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

  test('learns each day of the week on its own, so a weekend away does not count on Friday', () => {
    const harness = nightHarness();
    const saturdays = [9, 16, 23].map((day) => [
      String(day),
      { from: day * DAY_MS + 9 * HOUR_MS, to: day * DAY_MS + 17 * HOUR_MS },
    ]);
    Object.assign(harness.state.away, Object.fromEntries(saturdays));
    harness.advance(29 * DAY_MS + 12 * HOUR_MS - harness.now);
    expect(shiftOf(harness, 'build')).toBeNull();
    harness.advance(DAY_MS);
    expect(shiftOf(harness, 'build')).toBe('night');
  });

  test('reaches the agent at the end of its turn', () => {
    const harness = nightHarness({ pace: 0 });
    const taskId = createTask(harness);
    expect(harness.activeRun(taskId).prompt).toContain('Ask every question the build needs now');
    expect(harness.activeRun(taskId).rolePrompt).not.toContain('Ask every question');
  });
});
