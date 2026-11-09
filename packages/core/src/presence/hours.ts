import type { ActiveDay } from '../domain/settings.ts';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../domain/time.ts';
import type { TimingSpan } from '../domain/types.ts';
import { resolveTimeZoneOffset } from '../schedules/time.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  ACTIVE_HOURS_LIMITS,
  ACTIVE_HOURS_STEP_MINUTES,
  type ActiveHours,
  DAY_HOURS,
  type LocalSlot,
  WEEK_DAYS,
  WEEK_SLOTS,
} from './schema.ts';

export type ActiveHoursState = Pick<ShinsaState, 'away' | 'presence' | 'settings' | 'timeZone'>;

type LocalClock = (at: number) => LocalSlot;

interface MarkedHours {
  hours: ReadonlySet<number>;
  source: 'away' | 'activity';
}

const UTC = 'UTC';

const EPOCH_WEEKDAY = 4;

const STEP_MS = ACTIVE_HOURS_STEP_MINUTES * MINUTE_MS;

function resolveSlot(at: number, offset: number): LocalSlot {
  const local = at + offset;
  const day = Math.floor(local / DAY_MS);
  const weekday = (((day + EPOCH_WEEKDAY) % WEEK_DAYS) + WEEK_DAYS) % WEEK_DAYS;
  const hour = Math.floor((local - day * DAY_MS) / HOUR_MS);
  return { day, weekday, hour, slot: weekday * DAY_HOURS + hour };
}

function createLocalClock(timeZone: string): LocalClock {
  const offsets = new Map<number, number | null>();
  return (at) => {
    const day = Math.floor(at / DAY_MS);
    let offset = offsets.get(day);
    if (offset === undefined) {
      const start = resolveTimeZoneOffset(timeZone, day * DAY_MS);
      const end = resolveTimeZoneOffset(timeZone, (day + 1) * DAY_MS - 1);
      offset = start === end ? start : null;
      offsets.set(day, offset);
    }
    return resolveSlot(at, offset ?? resolveTimeZoneOffset(timeZone, at));
  };
}

export function resolveLocalSlot(timeZone: string, at: number) {
  return resolveSlot(at, resolveTimeZoneOffset(timeZone, at));
}

function listCoveredHours(spans: readonly TimingSpan[], from: number, to: number) {
  const covered = new Set<number>();
  for (const span of spans) {
    const start = Math.max(span.from, from);
    const end = Math.min(span.to, to);
    for (let hour = Math.floor(start / HOUR_MS); hour * HOUR_MS < end; hour += 1) {
      const overlap = Math.min(end, (hour + 1) * HOUR_MS) - Math.max(start, hour * HOUR_MS);
      if (overlap >= HOUR_MS * ACTIVE_HOURS_LIMITS.coveredShare) covered.add(hour);
    }
  }
  return covered;
}

function listActiveHours(presence: Record<string, number>, from: number, to: number) {
  return new Set(
    Object.entries(presence)
      .filter(([hour, count]) => count > 0 && Number(hour) * HOUR_MS >= from && Number(hour) * HOUR_MS < to)
      .map(([hour]) => Number(hour))
  );
}

function countDays(hours: ReadonlySet<number>, clock: LocalClock) {
  return new Set([...hours].map((hour) => clock(hour * HOUR_MS).day)).size;
}

function selectMarkedHours(state: ActiveHoursState, clock: LocalClock, from: number, now: number) {
  const away = listCoveredHours(Object.values(state.away), from, now);
  if (countDays(away, clock) >= ACTIVE_HOURS_LIMITS.minDays) return { hours: away, source: 'away' } as const;
  const active = listActiveHours(state.presence, from, now);
  if (countDays(active, clock) >= ACTIVE_HOURS_LIMITS.minDays)
    return { hours: active, source: 'activity' } as const;
  return null;
}

function createTally(length: number) {
  return {
    hit: Array<number>(length).fill(0),
    seen: Array<number>(length).fill(0),
    days: Array<number>(length).fill(0),
  };
}

function resolveWeek(marked: MarkedHours, clock: LocalClock, from: number, now: number) {
  const first = Math.min(...[...marked.hours].map((hour) => clock(hour * HOUR_MS).day));
  const today = clock(now).day;
  const week = createTally(WEEK_SLOTS);
  const day = createTally(DAY_HOURS);
  for (let hour = Math.ceil(from / HOUR_MS); (hour + 1) * HOUR_MS <= now; hour += 1) {
    const local = clock(hour * HOUR_MS);
    if (local.day < first) continue;
    const weight = 0.5 ** ((today - local.day) / ACTIVE_HOURS_LIMITS.halfLifeDays);
    const hit = marked.hours.has(hour) ? weight : 0;
    for (const [tally, index] of [
      [week, local.slot],
      [day, local.hour],
    ] as const) {
      tally.seen[index] = (tally.seen[index] ?? 0) + weight;
      tally.hit[index] = (tally.hit[index] ?? 0) + hit;
      tally.days[index] = (tally.days[index] ?? 0) + 1;
    }
  }
  const shares = Array.from({ length: WEEK_SLOTS }, (_, slot) => {
    const hour = slot % DAY_HOURS;
    const own = (week.days[slot] ?? 0) >= ACTIVE_HOURS_LIMITS.minWeekdayDays;
    const tally = own
      ? { hit: week.hit[slot] ?? 0, seen: week.seen[slot] ?? 0 }
      : { hit: day.hit[hour] ?? 0, seen: day.seen[hour] ?? 0 };
    return tally.hit / tally.seen;
  });
  return {
    week: shares.map((share) =>
      marked.source === 'away'
        ? share < ACTIVE_HOURS_LIMITS.awayShare
        : share >= ACTIVE_HOURS_LIMITS.activeShare
    ),
    observedDays: today - first + 1,
  };
}

function resolveTimeZone(state: Pick<ShinsaState, 'timeZone'>) {
  return state.timeZone ?? UTC;
}

let learned: { key: readonly unknown[]; value: ActiveHours | null } | null = null;

function isSameKey(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function resolveLearnedHours(state: ActiveHoursState, now: number): ActiveHours | null {
  const timeZone = resolveTimeZone(state);
  const key = [state.away, state.presence, timeZone, Math.floor(now / HOUR_MS)];
  if (learned && isSameKey(learned.key, key)) return learned.value;
  const clock = createLocalClock(timeZone);
  const from = now - ACTIVE_HOURS_LIMITS.windowDays * DAY_MS;
  const marked = selectMarkedHours(state, clock, from, now);
  const value = marked ? { source: marked.source, timeZone, ...resolveWeek(marked, clock, from, now) } : null;
  learned = { key, value };
  return value;
}

export function resolveOverrideWeek(days: readonly ActiveDay[]) {
  return Array.from({ length: WEEK_SLOTS }, (_, slot) => {
    const weekday = Math.floor(slot / DAY_HOURS);
    const hour = slot % DAY_HOURS;
    return days.some((day) => day.weekday === weekday && day.from <= hour && hour < day.to);
  });
}

export function resolveActiveHours(state: ActiveHoursState, now: number): ActiveHours | null {
  const override = state.settings.activeHours;
  if (!override) return resolveLearnedHours(state, now);
  return {
    source: 'override',
    timeZone: resolveTimeZone(state),
    week: resolveOverrideWeek(override),
    observedDays: 0,
  };
}

export function isActiveAt(hours: ActiveHours | null, at: number) {
  if (!hours) return true;
  return hours.week[resolveLocalSlot(hours.timeZone, at).slot] === true;
}

export function resolveNextActiveChange(hours: ActiveHours | null, at: number): number | null {
  if (!hours || hours.week.every((active) => active === hours.week[0])) return null;
  const clock = createLocalClock(hours.timeZone);
  const now = hours.week[clock(at).slot] === true;
  const first = (Math.floor(at / STEP_MS) + 1) * STEP_MS;
  const steps = Array.from(
    { length: ((WEEK_SLOTS + DAY_HOURS) * HOUR_MS) / STEP_MS },
    (_, index) => first + index * STEP_MS
  );
  return steps.find((step) => (hours.week[clock(step).slot] === true) !== now) ?? null;
}
