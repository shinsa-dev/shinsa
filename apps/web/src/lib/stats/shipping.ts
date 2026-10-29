import type { Stats, StatsDay } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import { formatShortDay, parseDayKey } from './days.ts';

export type ShippingLevel = 0 | 1 | 2 | 3 | 4;

export interface ShippingCell {
  day: string;
  pullRequests: number;
  level: ShippingLevel;
}

export interface ShippingGrid {
  weeks: (ShippingCell | null)[][];
  months: { label: string; week: number }[];
}

export interface ShippingTile {
  key: string;
  label: string;
  value: string;
  detail: string | null;
  changes?: { added: number; removed: number };
}

export interface ShippingPoint {
  label: string;
  from: string;
  pullRequests: number;
}

export const SHIPPING_SECTION = 'Shipping';

export const WEEKLY_AFTER_DAYS = 31;

export function resolveShippingLevel(count: number, max: number): ShippingLevel {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4)) as ShippingLevel;
}

export function resolveShippingGrid(days: StatsDay[]): ShippingGrid {
  const max = Math.max(0, ...days.map((day) => day.pullRequests));
  const weeks: (ShippingCell | null)[][] = [];
  const months: ShippingGrid['months'] = [];
  let lastMonth = -1;
  for (const day of days) {
    const date = parseDayKey(day.day);
    const weekday = date.getDay();
    if (weeks.length === 0 || weekday === 0) weeks.push(Array.from({ length: 7 }, () => null));
    const week = weeks.length - 1;
    (weeks[week] as (ShippingCell | null)[])[weekday] = {
      day: day.day,
      pullRequests: day.pullRequests,
      level: resolveShippingLevel(day.pullRequests, max),
    };
    if (date.getMonth() !== lastMonth && date.getDate() <= 7) {
      months.push({ label: date.toLocaleDateString(undefined, { month: 'short' }), week });
    }
    lastMonth = date.getMonth();
  }
  return { weeks, months };
}

export function formatPullRequests(count: number) {
  return count === 0 ? 'No pull requests' : formatCount(count, 'pull request', 'pull requests');
}

export function describeShippingYear(stats: Stats) {
  return `${formatCount(stats.total.pullRequests, 'pull request', 'pull requests')} merged in the last year`;
}

export function listShippingPoints(days: StatsDay[]): ShippingPoint[] {
  if (days.length <= WEEKLY_AFTER_DAYS) {
    return days.map((day) => ({
      label: formatShortDay(day.day),
      from: day.day,
      pullRequests: day.pullRequests,
    }));
  }
  const points: ShippingPoint[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const week = days.slice(Math.max(0, end - 7), end);
    const first = week[0] as StatsDay;
    points.unshift({
      label: `Week of ${formatShortDay(first.day)}`,
      from: first.day,
      pullRequests: week.reduce((sum, day) => sum + day.pullRequests, 0),
    });
  }
  return points;
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function listShippingTiles(stats: Stats, year: Stats): ShippingTile[] {
  const { total } = stats;
  const { streak } = year;
  return [
    {
      key: 'pull-requests',
      label: 'Pull requests merged',
      value: formatNumber(total.pullRequests),
      detail: null,
    },
    {
      key: 'tasks',
      label: 'Tasks finished',
      value: formatNumber(total.tasks),
      detail: null,
    },
    {
      key: 'lines',
      label: `Lines merged in ${formatCount(total.changedFiles, 'file', 'files')}`,
      value: formatNumber(total.additions + total.deletions),
      detail: null,
      changes: { added: total.additions, removed: total.deletions },
    },
    {
      key: 'streak',
      label: 'Shipping streak',
      value: formatCount(streak.current, 'day', 'days'),
      detail: `Longest ${formatCount(streak.longest, 'day', 'days')}`,
    },
  ];
}
