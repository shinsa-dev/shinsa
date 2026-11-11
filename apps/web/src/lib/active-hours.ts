import {
  type ActiveDay,
  type ActiveHours,
  ACTIVE_HOURS_LIMITS,
  DAY_HOURS,
  HOUR_MS,
  isActiveAt,
  resolveLocalSlot,
  resolveNextActiveChange,
} from '@shinsa/core';
import type { SettingItem } from '@/lib/settings.ts';

export const ACTIVE_HOURS_LABEL = {
  title: 'Your hours',
  description:
    'When you are usually at your Mac, learned from when you use it and what you do in Shinsa. Autopilot and auto pace plan around them.',
  learning: `Shinsa has not seen enough of your days yet. It learns your hours after ${ACTIVE_HOURS_LIMITS.minDays} days.`,
  setByHand: 'Set by hand',
  useLearned: 'Use learned hours',
  inactive: 'Not active',
  off: 'Off',
  split: 'This day has more than one span, so change it with shinsa settings set.',
  saved: { override: 'Your hours are set by hand.', learned: 'Shinsa learns your hours again.' },
  byHand: 'Set by hand',
} as const;

export const ACTIVE_HOURS_LEGEND = [
  { key: 'active', label: 'Usually active' },
  { key: 'away', label: 'Usually away' },
  { key: 'now', label: 'Now' },
] as const;

export const ACTIVE_HOURS_AXIS = [0, 6, 12, 18, 24].map((hour) => ({ hour, share: hour / DAY_HOURS }));

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const WORKDAY: Omit<ActiveDay, 'weekday'> = { from: 9, to: 17 };

const OFF = 'off';

export interface ActiveHourRow {
  weekday: number;
  name: string;
  cells: { hour: number; active: boolean }[];
  ranges: string;
  runs: ActiveRun[];
  span: ActiveDay | null;
  split: boolean;
}

interface ActiveRun {
  from: number;
  to: number;
  start: number;
  width: number;
  label: string;
}

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function listRuns(cells: readonly boolean[]) {
  const runs: { from: number; to: number }[] = [];
  cells.forEach((active, hour) => {
    if (!active) return;
    const last = runs.at(-1);
    if (last && last.to === hour) last.to = hour + 1;
    else runs.push({ from: hour, to: hour + 1 });
  });
  return runs;
}

export function describeRanges(cells: readonly boolean[]) {
  const runs = listRuns(cells);
  if (runs.length === 0) return ACTIVE_HOURS_LABEL.inactive;
  return runs.map((run) => `${formatHour(run.from)} to ${formatHour(run.to)}`).join(', ');
}

function resolveDayCells(hours: ActiveHours, weekday: number) {
  return hours.week.slice(weekday * DAY_HOURS, (weekday + 1) * DAY_HOURS);
}

export function listActiveHourRows(
  hours: ActiveHours,
  override: readonly ActiveDay[] | null
): ActiveHourRow[] {
  return WEEKDAY_ORDER.map((weekday) => {
    const cells = resolveDayCells(hours, weekday);
    return {
      weekday,
      name: WEEKDAY_NAMES[weekday],
      cells: cells.map((active, hour) => ({ hour, active })),
      ranges: describeRanges(cells),
      runs: listRuns(cells).map((run) => ({
        ...run,
        start: run.from / DAY_HOURS,
        width: (run.to - run.from) / DAY_HOURS,
        label: `${WEEKDAY_NAMES[weekday]}, ${formatHour(run.from)} to ${formatHour(run.to)}`,
      })),
      span: override?.find((day) => day.weekday === weekday) ?? null,
      split: (override?.filter((day) => day.weekday === weekday).length ?? 0) > 1,
    };
  });
}

export function describeActiveHoursSource(hours: ActiveHours) {
  if (hours.source === 'override') return `Set by hand, on ${hours.timeZone} time.`;
  const days = hours.observedDays === 1 ? '1 day' : `${hours.observedDays} days`;
  const from = hours.source === 'away' ? 'when you were away' : 'what you did';
  return `Learned from ${from} over ${days}, on ${hours.timeZone} time.`;
}

export function resolveOverrideDays(hours: ActiveHours | null): ActiveDay[] {
  if (!hours) return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, ...WORKDAY }));
  return WEEKDAY_ORDER.flatMap((weekday) => {
    const [longest] = listRuns(resolveDayCells(hours, weekday)).sort(
      (left, right) => right.to - right.from - (left.to - left.from) || left.from - right.from
    );
    return longest ? [{ weekday, ...longest }] : [];
  });
}

export function updateOverrideDay(
  days: readonly ActiveDay[],
  weekday: number,
  span: Omit<ActiveDay, 'weekday'> | null
) {
  const others = days.filter((day) => day.weekday !== weekday);
  const next = span ? [...others, { weekday, ...span }] : others;
  return next.sort((left, right) => left.weekday - right.weekday || left.from - right.from);
}

export function listFromItems(): SettingItem<string>[] {
  return [
    { value: OFF, label: ACTIVE_HOURS_LABEL.off },
    ...Array.from({ length: DAY_HOURS }, (_, hour) => ({ value: String(hour), label: formatHour(hour) })),
  ];
}

export function listToItems(from: number): SettingItem<string>[] {
  return Array.from({ length: DAY_HOURS - from }, (_, index) => {
    const hour = from + index + 1;
    return { value: String(hour), label: formatHour(hour) };
  });
}

export function resolveFromValue(span: ActiveDay | null) {
  return span ? String(span.from) : OFF;
}

export function readFromValue(value: string, span: ActiveDay | null): Omit<ActiveDay, 'weekday'> | null {
  if (value === OFF) return null;
  const from = Number(value);
  const to = span && span.to > from ? span.to : Math.min(DAY_HOURS, from + (WORKDAY.to - WORKDAY.from));
  return { from, to };
}

export function describeWeekTotal(hours: ActiveHours) {
  const total = hours.week.filter(Boolean).length;
  return total === 1 ? '1 hour a week' : `${total} hours a week`;
}

export function resolveNowMark(hours: ActiveHours, now: number) {
  const slot = resolveLocalSlot(hours.timeZone, now);
  return { weekday: slot.weekday, share: (slot.hour + (now % HOUR_MS) / HOUR_MS) / DAY_HOURS };
}

function formatChange(hours: ActiveHours, now: number, at: number) {
  const slot = resolveLocalSlot(hours.timeZone, at);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: hours.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return slot.day === resolveLocalSlot(hours.timeZone, now).day
    ? time
    : `${WEEKDAY_NAMES[slot.weekday]} ${time}`;
}

export function describeNow(hours: ActiveHours, now: number) {
  const active = isActiveAt(hours, now);
  const change = resolveNextActiveChange(hours, now);
  if (change === null) return active ? 'You are usually active at any hour.' : 'You are not usually active.';
  const until = formatChange(hours, now, change);
  return active ? `You are usually active now, until ${until}.` : `You are usually away now, until ${until}.`;
}
