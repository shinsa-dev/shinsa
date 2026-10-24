import { describe, expect, test } from 'bun:test';
import {
  type AccountUsage,
  listRelevantWindows,
  resolveHeadroom,
  resolveSpentUntil,
  resolveUsedPercent,
  resolveWeeklyPercent,
  resolveWeeklyUsed,
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
    expect(resolveUsedPercent(all, 'opus')).toBe(40);
    expect(resolveUsedPercent(all, 'fable')).toBe(85);
    expect(resolveHeadroom(all, 'fable')).toBe(15);
  });

  test('an unknown model, or a model window without a model, counts against every run', () => {
    const anonymous = window({ id: 'weekly:x', kind: 'model', model: null, usedPercent: 70 });
    expect(resolveUsedPercent(usage([SESSION, FABLE]), null)).toBe(85);
    expect(resolveUsedPercent(usage([SESSION, anonymous]), 'opus')).toBe(70);
  });

  test('no windows means no figure, and usage over the limit leaves no headroom', () => {
    expect(resolveUsedPercent(usage([]), 'opus')).toBeNull();
    expect(resolveHeadroom(usage([]), 'opus')).toBeNull();
    expect(resolveHeadroom(usage([window({ usedPercent: 120 })]), 'opus')).toBe(0);
  });

  test('a spent account is spent until the last of its full windows resets', () => {
    const full = usage([
      window({ usedPercent: 100, resetsAt: 3_000 }),
      window({ id: 'seven_day', kind: 'weekly', usedPercent: 100, resetsAt: 9_000 }),
      window({ id: 'weekly:fable', kind: 'model', model: 'Fable', usedPercent: 100, resetsAt: 20_000 }),
    ]);
    expect(resolveSpentUntil(full, 'opus', 1_000)).toBe(9_000);
    expect(resolveSpentUntil(full, 'fable', 1_000)).toBe(20_000);
    expect(resolveSpentUntil(full, 'opus', 10_000)).toBeNull();
    expect(
      resolveSpentUntil(usage([window({ usedPercent: 100, resetsAt: null })]), 'opus', 1_000)
    ).toBeNull();
    expect(resolveSpentUntil(usage([SESSION]), 'opus', 1_000)).toBeNull();
  });
});

describe('the weekly window a task budget counts', () => {
  test('reads the all-models weekly window and nothing else', () => {
    expect(resolveWeeklyPercent(usage([SESSION, WEEKLY, FABLE]))).toBe(20);
    expect(resolveWeeklyPercent(usage([SESSION, FABLE]))).toBeNull();
  });

  test('counts what a run added, starts over when the window reset, and needs both readings', () => {
    expect(resolveWeeklyUsed(20, 23.5)).toBe(3.5);
    expect(resolveWeeklyUsed(80, 2)).toBe(2);
    expect(resolveWeeklyUsed(null, 30)).toBeNull();
    expect(resolveWeeklyUsed(30, null)).toBeNull();
  });
});
