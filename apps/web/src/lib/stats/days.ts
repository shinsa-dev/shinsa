import type { StatsWindow } from '@shinsa/core';

export type StatsRange = 7 | 30 | 90;

export const STATS_RANGES: readonly { value: `${StatsRange}`; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export const DEFAULT_STATS_RANGE: StatsRange = 30;

export const YEAR_WEEKS = 53;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function resolveDayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDayKey(day: string) {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

export function listCalendarDays(now: number, count: number) {
  const today = new Date(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index));
    return resolveDayKey(date.getTime());
  });
}

export function resolveRangeWindow(now: number, range: number): StatsWindow {
  return { days: listCalendarDays(now, range), dayOf: resolveDayKey };
}

export function resolveYearWindow(now: number): StatsWindow {
  const weekday = new Date(now).getDay();
  return resolveRangeWindow(now, (YEAR_WEEKS - 1) * 7 + weekday + 1);
}

export function parseStatsRange(value: string): StatsRange {
  return value === '7' || value === '90' ? (Number(value) as StatsRange) : DEFAULT_STATS_RANGE;
}

export function formatDayLabel(day: string) {
  return parseDayKey(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatShortDay(day: string) {
  return parseDayKey(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
