import { describe, expect, it } from 'bun:test';
import {
  countCalendarDays,
  DEFAULT_STATS_RANGE,
  formatDayLabel,
  formatShortDay,
  listCalendarDays,
  parseDayKey,
  parseStatsRange,
  resolveDayKey,
  resolveFirstActivity,
  resolveRangeWindow,
  resolveStatsWindow,
  resolveYearWindow,
  YEAR_WEEKS,
} from '@/lib/stats/days.ts';

describe('stats days', () => {
  it('keys a moment by its local calendar day and reads the key back', () => {
    const at = new Date(2026, 2, 9, 23, 30).getTime();
    expect(resolveDayKey(at)).toBe('2026-03-09');
    expect(parseDayKey('2026-03-09').getTime()).toBe(new Date(2026, 2, 9).getTime());
    expect(parseDayKey('').getFullYear()).toBe(1900);
  });

  it('lists calendar days up to today, across a month end and a clock change', () => {
    const now = new Date(2026, 2, 30, 12).getTime();
    expect(listCalendarDays(now, 3)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    const days = listCalendarDays(new Date(2026, 3, 2).getTime(), 40);
    expect(new Set(days).size).toBe(40);
    expect(days.at(-1)).toBe('2026-04-02');
  });

  it('a window keys by day, and the year starts on the Sunday of its first week', () => {
    const now = new Date(2026, 9, 29, 9).getTime();
    const range = resolveRangeWindow(now, 7);
    expect(range.days).toHaveLength(7);
    expect(range.dayOf(now)).toBe('2026-10-29');
    const year = resolveYearWindow(now);
    expect(year.days.at(-1)).toBe('2026-10-29');
    expect(parseDayKey(year.days[0] as string).getDay()).toBe(0);
    expect(year.days.length).toBe((YEAR_WEEKS - 1) * 7 + 5);
  });

  it('reads a range from the URL, else the default', () => {
    expect(parseStatsRange('7')).toBe(7);
    expect(parseStatsRange('90')).toBe(90);
    expect(parseStatsRange('all')).toBe('all');
    expect(parseStatsRange('30')).toBe(DEFAULT_STATS_RANGE);
    expect(parseStatsRange('nonsense')).toBe(DEFAULT_STATS_RANGE);
  });

  it('labels a day for a readout and an axis', () => {
    expect(formatDayLabel('2026-10-29')).toContain('29');
    expect(formatShortDay('2026-10-29')).toContain('29');
  });

  it('all time reaches back to the first task or run, never shorter than the default range', () => {
    const now = new Date(2026, 9, 29, 9).getTime();
    const since = new Date(2025, 9, 29, 22).getTime();
    expect(countCalendarDays(since, now)).toBe(366);
    expect(resolveStatsWindow(now, 'all', since).days).toHaveLength(366);
    expect(resolveStatsWindow(now, 'all', since).days[0]).toBe('2025-10-29');
    expect(resolveStatsWindow(now, 'all', now).days).toHaveLength(DEFAULT_STATS_RANGE);
    expect(resolveStatsWindow(now, 'all', null).days).toHaveLength(DEFAULT_STATS_RANGE);
    expect(resolveStatsWindow(now, 'all', now + 1).days).toHaveLength(DEFAULT_STATS_RANGE);
    expect(resolveStatsWindow(now, 7, since).days).toHaveLength(7);
  });

  it('finds the first task or run in the log, or none', () => {
    expect(resolveFirstActivity({ tasks: {}, runs: {} })).toBeNull();
    const tasks = { a: { createdAt: 50 } } as unknown as Parameters<typeof resolveFirstActivity>[0]['tasks'];
    const runs = { r: { startedAt: 20 } } as unknown as Parameters<typeof resolveFirstActivity>[0]['runs'];
    expect(resolveFirstActivity({ tasks, runs })).toBe(20);
  });
});
