import { SCHEDULE_LIMITS, type ScheduleTrigger } from '../domain/schedules.ts';
import { HOUR_MS, MINUTE_MS } from '../domain/time.ts';

const TRANSITION_REACH = 36 * HOUR_MS;

const DAYS_TO_SEARCH = 7;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function resolveFormatter(timeZone: string) {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

export function isTimeZone(value: string) {
  try {
    resolveFormatter(value);
    return true;
  } catch {
    return false;
  }
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function serializeTimeOfDay(time: { hour: number; minute: number }) {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function readWallClock(timeZone: string, at: number): WallClock & { second: number } {
  const parts = resolveFormatter(timeZone).formatToParts(new Date(at));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function resolveOffset(timeZone: string, at: number) {
  const wall = readWallClock(timeZone, at);
  const local = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return local - Math.floor(at / 1000) * 1000;
}

function isWallClock(timeZone: string, at: number, wall: WallClock) {
  const actual = readWallClock(timeZone, at);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute
  );
}

export function resolveZonedInstant(timeZone: string, wall: WallClock) {
  const local = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const before = local - resolveOffset(timeZone, local - TRANSITION_REACH);
  const after = local - resolveOffset(timeZone, local + TRANSITION_REACH);
  const valid = [before, after].filter((at) => isWallClock(timeZone, at, wall));
  if (valid.length > 0) return Math.min(...valid);
  return before;
}

function resolveNextDaily(
  trigger: Extract<ScheduleTrigger, { kind: 'daily' }>,
  after: number,
  timeZone: string
) {
  const time = parseTimeOfDay(trigger.time);
  if (!time) return null;
  const today = readWallClock(timeZone, after);
  for (let offset = 0; offset <= DAYS_TO_SEARCH; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (trigger.weekdays.length > 0 && !trigger.weekdays.includes(date.getUTCDay())) continue;
    const at = resolveZonedInstant(timeZone, {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
    });
    if (at > after) return at;
  }
  return null;
}

export function resolveNextRun(trigger: ScheduleTrigger, after: number, timeZone: string): number | null {
  switch (trigger.kind) {
    case 'once':
      return trigger.at > after ? trigger.at : null;
    case 'interval':
      return after + Math.max(SCHEDULE_LIMITS.minEveryMinutes, trigger.everyMinutes) * MINUTE_MS;
    case 'daily':
      return resolveNextDaily(trigger, after, timeZone);
    case 'webhook':
      return null;
  }
}

export function resolveFirstRun(trigger: ScheduleTrigger, now: number, timeZone: string) {
  if (trigger.kind === 'once') return trigger.at;
  return resolveNextRun(trigger, now, timeZone);
}
