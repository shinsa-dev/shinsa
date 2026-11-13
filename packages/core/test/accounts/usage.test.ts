import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  type AccountUsage,
  isModelMarkFor,
  listRelevantWindows,
  listWeeklyWindows,
  resolveLimitScope,
  resolveHeadroom,
  resolveSpentUntil,
  STALE_USAGE_MS,
  isStaleUsage,
  resolveUsedPercent,
  resolveWeeklyPercent,
  resolveWeeklyReading,
  type UsageWindow,
} from '../../src/index.ts';

function window(overrides: Partial<UsageWindow>): UsageWindow {
  return {
    id: 'five_hour',
    kind: 'session',
    label: '5-hour limit',
    model: null,
    usedPercent: 10,
    resetsAt: 5_000,
    ...overrides,
  };
}

function usage(windows: UsageWindow[]): AccountUsage {
  return { status: 'ok', windows, detail: null, checkedAt: 1_000, source: 'read' };
}

const SESSION = window({ usedPercent: 40 });

const WEEKLY = window({ id: 'seven_day', kind: 'weekly', label: 'Weekly · All models', usedPercent: 20 });

const FABLE = window({
  id: 'weekly:fable',
  kind: 'model',
  label: 'Weekly · Fable',
  model: 'Fable',
  usedPercent: 85,
});

const SPEND = window({ id: 'spend', kind: 'other', label: 'Usage credits', usedPercent: 99 });

describe('usage headroom', () => {
  test('a model window counts only for runs on that model, and spend never counts', () => {
    const all = usage([SESSION, WEEKLY, FABLE, SPEND]);
    expect(listRelevantWindows(all, 'opus').map((item) => item.id)).toEqual(['five_hour', 'seven_day']);
    expect(listRelevantWindows(all, 'claude-fable-5-1').map((item) => item.id)).toEqual([
      'five_hour',
      'seven_day',
      'weekly:fable',
    ]);
    expect(Option.getOrNull(resolveUsedPercent(all, 'opus'))).toBe(40);
    expect(Option.getOrNull(resolveUsedPercent(all, 'fable'))).toBe(85);
    expect(Option.getOrNull(resolveHeadroom(all, 'fable'))).toBe(15);
  });

  test('an unknown model, or a model window without a model, counts against every run', () => {
    const anonymous = window({ id: 'weekly:x', kind: 'model', model: null, usedPercent: 70 });
    expect(Option.getOrNull(resolveUsedPercent(usage([SESSION, FABLE]), null))).toBe(85);
    expect(Option.getOrNull(resolveUsedPercent(usage([SESSION, anonymous]), 'opus'))).toBe(70);
  });

  test('no windows means no figure, and usage over the limit leaves no headroom', () => {
    expect(Option.getOrNull(resolveUsedPercent(usage([]), 'opus'))).toBeNull();
    expect(Option.getOrNull(resolveHeadroom(usage([]), 'opus'))).toBeNull();
    expect(Option.getOrNull(resolveHeadroom(usage([window({ usedPercent: 120 })]), 'opus'))).toBe(0);
  });

  test('a spent account is spent until the last of its full windows resets', () => {
    const full = usage([
      window({ usedPercent: 100, resetsAt: 3_000 }),
      window({ id: 'seven_day', kind: 'weekly', usedPercent: 100, resetsAt: 9_000 }),
      window({ id: 'weekly:fable', kind: 'model', model: 'Fable', usedPercent: 100, resetsAt: 20_000 }),
    ]);
    expect(Option.getOrNull(resolveSpentUntil(full, 'opus', 1_000))).toBe(9_000);
    expect(Option.getOrNull(resolveSpentUntil(full, 'fable', 1_000))).toBe(20_000);
    expect(Option.getOrNull(resolveSpentUntil(full, 'opus', 10_000))).toBeNull();
    expect(
      Option.getOrNull(
        resolveSpentUntil(usage([window({ usedPercent: 100, resetsAt: null })]), 'opus', 1_000)
      )
    ).toBeNull();
    expect(Option.getOrNull(resolveSpentUntil(usage([SESSION]), 'opus', 1_000))).toBeNull();
  });

  test('a reading older than the stale limit no longer counts as spent', () => {
    const resetsAt = 1_000 + 10 * STALE_USAGE_MS;
    const full = usage([window({ id: 'seven_day', kind: 'weekly', usedPercent: 100, resetsAt })]);
    expect(Option.getOrNull(resolveSpentUntil(full, 'opus', 1_000 + STALE_USAGE_MS))).toBe(resetsAt);
    expect(Option.getOrNull(resolveSpentUntil(full, 'opus', 1_001 + STALE_USAGE_MS))).toBeNull();
    expect(isStaleUsage(full, 1_000 + STALE_USAGE_MS)).toBe(false);
    expect(isStaleUsage(full, 1_001 + STALE_USAGE_MS)).toBe(true);
  });

  test('a reading with no time is never stale', () => {
    const resetsAt = 1_000 + 10 * STALE_USAGE_MS;
    const untimed = { ...usage([window({ usedPercent: 100, resetsAt })]), checkedAt: null };
    expect(isStaleUsage(untimed, resetsAt - 1)).toBe(false);
    expect(Option.getOrNull(resolveSpentUntil(untimed, 'opus', resetsAt - 1))).toBe(resetsAt);
  });
});

describe('the weekly window a task budget counts', () => {
  test('reads the all-models weekly window and nothing else', () => {
    expect(Option.getOrNull(resolveWeeklyPercent(usage([SESSION, WEEKLY, FABLE])))).toBe(20);
    expect(Option.getOrNull(resolveWeeklyPercent(usage([SESSION, FABLE])))).toBeNull();
  });

  test('a reading is the weekly window when it was read, with its reset; a pushed value has no time', () => {
    const read = { ...usage([SESSION, WEEKLY]), checkedAt: 5_000, source: 'read' as const };
    expect(Option.getOrNull(resolveWeeklyReading(read))).toEqual({
      percent: 20,
      at: 5_000,
      resetsAt: WEEKLY.resetsAt,
    });
    expect(Option.getOrNull(resolveWeeklyReading({ ...read, source: 'push' }))).toBeNull();
    expect(Option.getOrNull(resolveWeeklyReading({ ...read, checkedAt: null }))).toBeNull();
    expect(Option.getOrNull(resolveWeeklyReading({ ...read, windows: [SESSION] }))).toBeNull();
  });
});

describe('which limit stopped a run', () => {
  const NOW = 2_000;

  test('a run stopped while only its model’s own window is the fullest hit that model’s limit', () => {
    const all = usage([SESSION, WEEKLY, FABLE]);
    expect(resolveLimitScope(all, 'claude-fable-5-2', NOW)).toBe('model');
    expect(resolveLimitScope(all, 'fable', NOW)).toBe('model');
  });

  test('a full shared window, or one fuller than the model’s own, is the whole account’s limit', () => {
    const fullWeek = usage([window({ ...WEEKLY, usedPercent: 100 }), FABLE]);
    expect(resolveLimitScope(fullWeek, 'fable', NOW)).toBe('account');
    const fullSession = usage([window({ usedPercent: 100 }), FABLE]);
    expect(resolveLimitScope(fullSession, 'fable', NOW)).toBe('account');
    const fullerWeek = usage([window({ ...WEEKLY, usedPercent: 90 }), FABLE]);
    expect(resolveLimitScope(fullerWeek, 'fable', NOW)).toBe('account');
  });

  test('without a model, a model window or a fresh reading it is the whole account’s limit', () => {
    const all = usage([SESSION, WEEKLY, FABLE]);
    expect(resolveLimitScope(all, null, NOW)).toBe('account');
    expect(resolveLimitScope(all, 'opus', NOW)).toBe('account');
    expect(resolveLimitScope({ ...all, checkedAt: null }, 'fable', NOW)).toBe('account');
    expect(resolveLimitScope(all, 'fable', 1_000 + STALE_USAGE_MS + 1)).toBe('account');
  });

  test('a mark for one model applies to that model, and a mark without one to every model', () => {
    expect(isModelMarkFor('fable', 'claude-fable-5-2')).toBe(true);
    expect(isModelMarkFor('fable', 'opus')).toBe(false);
    expect(isModelMarkFor('fable', null)).toBe(true);
    expect(isModelMarkFor(null, 'opus')).toBe(true);
    expect(isModelMarkFor(undefined, 'opus')).toBe(true);
  });

  test('the weekly windows of a model are the all-models one and its own', () => {
    const all = usage([SESSION, WEEKLY, FABLE, SPEND]);
    expect(listWeeklyWindows(all, 'fable').map((item) => item.id)).toEqual(['seven_day', 'weekly:fable']);
    expect(listWeeklyWindows(all, 'opus').map((item) => item.id)).toEqual(['seven_day']);
    expect(listWeeklyWindows(all, null).map((item) => item.id)).toEqual(['seven_day']);
  });
});
