import { HOUR_MS, MINUTE_MS } from '../domain/time.ts';
import type { FocusSpan, Task, TimingSpan } from '../domain/types.ts';
import { resolvePresenceHour } from '../state/presence.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskTiming } from '../state/timing.ts';
import { isWithin, mergeSpans, subtractSpans } from './spans.ts';

export const WEEK_HOURS = 7 * 24;
export const PRESENCE_PROFILE_WEEKS = 8;
export const PRESENCE_REACH_HOURS = 6;
export const FOCUS_GRACE_MS = 30 * MINUTE_MS;

export type YourActivity = Pick<ShinsaState, 'tasks'> &
  Partial<Pick<ShinsaState, 'presence' | 'away' | 'focusHistory'>>;

export type HourOfWeek = (at: number) => number;

export interface YourClock {
  activeHours: ReadonlySet<number>;
  firstHour: number | null;
  profile: readonly number[];
  hourOf: HourOfWeek;
  away: TimingSpan[];
  focus: FocusSpan[];
}

function listActiveHours(presence: Record<string, number>) {
  return Object.entries(presence)
    .filter(([, count]) => count > 0)
    .map(([hour]) => Number(hour));
}

function smoothProfile(shares: readonly number[]) {
  return shares.map((share, slot) => {
    const before = shares[(slot + WEEK_HOURS - 1) % WEEK_HOURS] ?? 0;
    const after = shares[(slot + 1) % WEEK_HOURS] ?? 0;
    return (before + 2 * share + after) / 4;
  });
}

function resolveReference(shares: readonly number[]) {
  const nonzero = shares.filter((share) => share > 0).sort((a, b) => a - b);
  return nonzero[Math.floor((nonzero.length - 1) * 0.75)] ?? 0;
}

export function resolvePresenceProfile(presence: Record<string, number>, now: number, hourOf: HourOfWeek) {
  const nowHour = resolvePresenceHour(now);
  const from = nowHour - PRESENCE_PROFILE_WEEKS * WEEK_HOURS;
  const hours = listActiveHours(presence).filter((hour) => hour > from && hour <= nowHour);
  if (hours.length === 0) return Array.from({ length: WEEK_HOURS }, () => 1);
  const start = Math.max(from + 1, Math.min(...hours));
  const weeks = Math.max(1, Math.ceil((nowHour - start + 1) / WEEK_HOURS));
  const counts = Array.from({ length: WEEK_HOURS }, () => 0);
  for (const hour of hours) {
    const slot = hourOf(hour * HOUR_MS);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  const smoothed = smoothProfile(counts.map((count) => Math.min(1, count / weeks)));
  const reference = resolveReference(smoothed);
  return smoothed.map((share) => Math.min(1, share / reference));
}

function listInputTimes(tasks: ShinsaState['tasks']) {
  return Object.values(tasks)
    .flatMap((task) => resolveTaskTiming(task).inputs.map((input) => input.at))
    .sort((a, b) => a - b);
}

function hasTimeWithin(times: readonly number[], span: TimingSpan) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((times[middle] ?? 0) <= span.from) low = middle + 1;
    else high = middle;
  }
  const first = times[low];
  return first !== undefined && isWithin(first, span);
}

function listAway(you: YourActivity) {
  const inputs = listInputTimes(you.tasks);
  return mergeSpans(Object.values(you.away ?? {}).filter((span) => !hasTimeWithin(inputs, span)));
}

export function resolveYourClock(you: YourActivity, now: number, hourOf: HourOfWeek): YourClock {
  const presence = you.presence ?? {};
  const hours = listActiveHours(presence);
  return {
    activeHours: new Set(hours),
    firstHour: hours.length === 0 ? null : Math.min(...hours),
    profile: resolvePresenceProfile(presence, now, hourOf),
    hourOf,
    away: listAway(you),
    focus: Object.values(you.focusHistory ?? {}),
  };
}

export function listSetAside(clock: YourClock, task: Task, now: number): TimingSpan[] {
  const inputs = resolveTaskTiming(task).inputs;
  return clock.focus.flatMap((focus) => {
    if (focus.projectId === task.projectId) return [];
    const span = { from: focus.from, to: Math.min(focus.to ?? now, focus.until ?? now) };
    if (inputs.some((input) => isWithin(input.at, span))) return [];
    const from = span.from + FOCUS_GRACE_MS;
    return span.to > from ? [{ from, to: span.to }] : [];
  });
}

function isNearActivity(clock: YourClock, hour: number) {
  for (let offset = -PRESENCE_REACH_HOURS; offset <= PRESENCE_REACH_HOURS; offset += 1) {
    if (clock.activeHours.has(hour + offset)) return true;
  }
  return false;
}

export function resolveHourWeight(clock: YourClock, hour: number) {
  if (clock.activeHours.has(hour)) return 1;
  const known = clock.firstHour !== null && hour >= clock.firstHour;
  if (known && !isNearActivity(clock, hour)) return 0;
  return clock.profile[clock.hourOf(hour * HOUR_MS)] ?? 0;
}

function measureHours(clock: YourClock, span: TimingSpan) {
  let total = 0;
  for (let hour = resolvePresenceHour(span.from); hour * HOUR_MS < span.to; hour += 1) {
    const overlap = Math.min(span.to, (hour + 1) * HOUR_MS) - Math.max(span.from, hour * HOUR_MS);
    total += overlap * resolveHourWeight(clock, hour);
  }
  return total;
}

export function measureOnYourClock(clock: YourClock, span: TimingSpan) {
  return subtractSpans(span, clock.away).reduce((total, part) => total + measureHours(clock, part), 0);
}
