import { describe, expect, it } from 'bun:test';
import { resolveStats, type Stats, type StatsDay } from '@shinsa/core';
import { listCalendarDays, resolveDayKey } from '@/lib/stats/days.ts';
import {
  describeShippingYear,
  formatPullRequests,
  listShippingPoints,
  listShippingTiles,
  resolveShippingGrid,
  resolveShippingLevel,
} from '@/lib/stats/shipping.ts';

function statsOf(days: string[], counts: Record<string, number> = {}, overrides: Partial<Stats> = {}): Stats {
  const stats = resolveStats({ tasks: {}, runs: {} }, { days, dayOf: resolveDayKey });
  const withCounts = stats.days.map((day): StatsDay => ({ ...day, pullRequests: counts[day.day] ?? 0 }));
  return { ...stats, days: withCounts, ...overrides };
}

describe('shipping', () => {
  it('shades a day in four steps of the busiest day', () => {
    expect(resolveShippingLevel(0, 8)).toBe(0);
    expect(resolveShippingLevel(3, 0)).toBe(0);
    expect(resolveShippingLevel(1, 8)).toBe(1);
    expect(resolveShippingLevel(4, 8)).toBe(2);
    expect(resolveShippingLevel(6, 8)).toBe(3);
    expect(resolveShippingLevel(8, 8)).toBe(4);
  });

  it('lays the days out in week columns from Sunday, with a label where each month starts', () => {
    const days = listCalendarDays(new Date(2026, 10, 4).getTime(), 14);
    const grid = resolveShippingGrid(statsOf(days, { '2026-11-02': 2, '2026-11-03': 1 }).days);
    expect(grid.weeks).toHaveLength(3);
    expect(grid.weeks[0]?.slice(0, 4)).toEqual([null, null, null, null]);
    expect(grid.weeks[0]?.[4]?.day).toBe('2026-10-22');
    expect(grid.weeks[2]?.[1]).toEqual({ day: '2026-11-02', pullRequests: 2, level: 4 });
    expect(grid.weeks[2]?.[2]?.level).toBe(2);
    expect(grid.months).toHaveLength(1);
    expect(grid.months[0]?.week).toBe(2);
  });

  it('says what a day and the year shipped', () => {
    expect(formatPullRequests(0)).toBe('No pull requests');
    expect(formatPullRequests(1)).toBe('1 pull request');
    const year = statsOf([]);
    expect(describeShippingYear({ ...year, total: { ...year.total, pullRequests: 3 } })).toBe(
      '3 pull requests merged in the last year'
    );
  });

  it('charts a month day by day and a longer range week by week, the last week ending today', () => {
    const month = listCalendarDays(new Date(2026, 10, 30).getTime(), 30);
    const daily = listShippingPoints(statsOf(month, { '2026-11-30': 2 }).days);
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)?.pullRequests).toBe(2);
    const quarter = listCalendarDays(new Date(2026, 10, 30).getTime(), 90);
    const weekly = listShippingPoints(
      statsOf(quarter, { '2026-11-30': 2, '2026-11-24': 1, '2026-09-03': 4 }).days
    );
    expect(weekly).toHaveLength(13);
    expect(weekly.at(-1)).toMatchObject({ from: '2026-11-24', pullRequests: 3 });
    expect(weekly[0]).toMatchObject({ from: '2026-09-02', pullRequests: 4 });
    expect(weekly.at(-1)?.label).toMatch(/^Week of /);
  });

  it('tiles the range totals and the streak of the year', () => {
    const range = statsOf([]);
    const stats = {
      ...range,
      total: {
        ...range.total,
        pullRequests: 1200,
        tasks: 4,
        additions: 1500,
        deletions: 20,
        changedFiles: 1,
      },
    };
    const year = { ...range, streak: { current: 1, longest: 9 } };
    expect(listShippingTiles(stats, year)).toEqual([
      { key: 'pull-requests', label: 'Pull requests merged', value: '1,200', detail: null },
      { key: 'tasks', label: 'Tasks finished', value: '4', detail: null },
      {
        key: 'lines',
        label: 'Lines changed in 1 file',
        value: '1,520',
        detail: null,
        changes: { added: 1500, removed: 20 },
      },
      { key: 'streak', label: 'Shipping streak', value: '1 day', detail: 'Longest 9 days' },
    ]);
  });
});
