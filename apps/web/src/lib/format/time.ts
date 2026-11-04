import { DAY_MS, HOUR_MS, MINUTE_MS } from '@shinsa/core';

const RELATIVE_AGE = /^\d+[mhd]$/;

const WEEK_DAYS = 6;

const MONTH_DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

const FULL_DAY = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' });

const CLOCK = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

function formatGap(gap: number, at: number) {
  const seconds = Math.max(0, Math.round(gap / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return MONTH_DAY.format(at);
}

export function formatAge(at: number, now = Date.now()) {
  return formatGap(now - at, at);
}

function describeAge(age: string) {
  if (age === 'just now') return age;
  return RELATIVE_AGE.test(age) ? `${age} ago` : `on ${age}`;
}

function describeAhead(gap: string) {
  if (gap === 'just now') return 'in under a minute';
  return RELATIVE_AGE.test(gap) ? `in ${gap}` : `on ${gap}`;
}

export function formatTimeAgo(at: number, now = Date.now()) {
  const age = formatAge(at, now);
  if (age === 'just now') return 'Just now';
  return RELATIVE_AGE.test(age) ? `${age} ago` : age;
}

export function formatSince(prefix: string, at: number, now = Date.now()) {
  return `${prefix} ${describeAge(formatAge(at, now))}`;
}

export function formatUntil(prefix: string, at: number, now = Date.now()) {
  return `${prefix} ${describeAhead(formatGap(at - now, at))}`;
}

function formatHoursAndMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return formatHoursAndMinutes(minutes);
}

export function formatTurnaround(ms: number) {
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))}m`;
  if (ms < DAY_MS) return formatHoursAndMinutes(Math.round(ms / MINUTE_MS));
  return `${(ms / DAY_MS).toFixed(1).replace(/\.0$/, '')}d`;
}

export function formatDaysAndHours(ms: number) {
  if (ms < DAY_MS) return formatTurnaround(ms);
  const hours = Math.round(ms / HOUR_MS);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

export function formatWholeHours(ms: number) {
  return `${Math.max(1, Math.ceil(ms / HOUR_MS))} h`;
}

export function formatTimeLeft(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  return minutes < 60 ? `${minutes} min` : formatWholeHours(ms);
}

export function formatMinuteSpan(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export function formatSpan(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / MINUTE_MS));
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function formatDay(at: number) {
  return FULL_DAY.format(at);
}

export function formatClock(at: number) {
  return CLOCK.format(at);
}

function resolveStartOfDay(at: number) {
  return new Date(at).setHours(0, 0, 0, 0);
}

export function isSameDay(at: number, now = Date.now()) {
  return resolveStartOfDay(at) === resolveStartOfDay(now);
}

export function formatMoment(at: number, now = Date.now()) {
  const days = Math.round((resolveStartOfDay(at) - resolveStartOfDay(now)) / DAY_MS);
  if (days === 0) return formatClock(at);
  if (days > 0 && days <= WEEK_DAYS) {
    return `${WEEKDAY.format(at)} ${formatClock(at)}`;
  }
  return `${MONTH_DAY.format(at)}, ${formatClock(at)}`;
}

export function resolveMinute(now = Date.now()) {
  return Math.floor(now / MINUTE_MS);
}

export function resolveEndOfDay(now = Date.now()) {
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  return end.getTime();
}
