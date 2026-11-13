import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  ACTIVE_HOURS_LIMITS,
  type ActiveHours,
  createSettings,
  createState,
  DAY_HOURS,
  DAY_MS,
  HOUR_MS,
  isActiveAt,
  resolveActiveHours,
  resolveLearnedHours,
  resolveLocalSlot,
  resolveNextActiveChange,
  type ShinsaState,
  type TimingSpan,
  WEEK_SLOTS,
} from '../../src/index.ts';
import { createHarness } from '../harness.ts';

const NOW = Date.UTC(2026, 3, 10, 12);

const TODAY = Math.floor(NOW / DAY_MS) * DAY_MS;

const WORK_HOURS = [9, 10, 11, 12, 13, 14, 15, 16];

function listDays(count: number, skip = 1) {
  return Array.from({ length: count }, (_, index) => index + skip);
}

function writePresence(days: readonly number[], hours: readonly number[], base = TODAY) {
  const presence: Record<string, number> = {};
  for (const day of days) {
    for (const hour of hours) presence[String((base - day * DAY_MS) / HOUR_MS + hour)] = 1;
  }
  return presence;
}

function writeNights(days: readonly number[], from: number, length: number) {
  const away: Record<string, TimingSpan> = {};
  for (const day of days) {
    const start = TODAY - day * DAY_MS + from * HOUR_MS;
    away[String(start)] = { from: start, to: start + length * HOUR_MS };
  }
  return away;
}

function createActivity(overrides: Partial<ShinsaState>): ShinsaState {
  return { ...createState(), ...overrides };
}

function at(daysAgo: number, hour: number) {
  return TODAY - daysAgo * DAY_MS + hour * HOUR_MS;
}

function findHours(found: Option.Option<ActiveHours>, weekday: number) {
  const hours = Option.getOrNull(found);
  return Array.from({ length: DAY_HOURS }, (_, hour) => hour).filter(
    (hour) => hours?.week[weekday * DAY_HOURS + hour] === true
  );
}

describe('learning when you are usually active', () => {
  test('knows nothing until you were around on three days', () => {
    expect(Option.isNone(resolveLearnedHours(createState(), NOW))).toBe(true);
    const state = createActivity({ presence: writePresence(listDays(2), WORK_HOURS) });
    expect(Option.isNone(resolveActiveHours(state, NOW))).toBe(true);
  });

  test('from what you did: the hours you are around on are active, the rest are not', () => {
    const state = createActivity({ presence: writePresence(listDays(10), WORK_HOURS) });
    const hours = resolveLearnedHours(state, NOW);
    expect(Option.getOrNull(hours)).toMatchObject({ source: 'activity', timeZone: 'UTC', observedDays: 11 });
    expect(Option.getOrNull(hours)?.week).toHaveLength(WEEK_SLOTS);
    expect(findHours(hours, 3)).toEqual(WORK_HOURS);
    expect(isActiveAt(hours, at(1, 10))).toBe(true);
    expect(isActiveAt(hours, at(1, 3))).toBe(false);
  });

  test('reads the hours on your own clock', () => {
    const presence = writePresence(listDays(10), WORK_HOURS);
    const hours = resolveLearnedHours(createActivity({ presence, timeZone: 'Asia/Tokyo' }), NOW);
    expect(Option.getOrNull(hours)?.timeZone).toBe('Asia/Tokyo');
    expect(findHours(hours, 3)).toEqual([0, 1, 18, 19, 20, 21, 22, 23]);
  });

  test('from time away: the hours you are usually away for are not active', () => {
    const state = createActivity({ away: writeNights(listDays(6), 22, 8) });
    const hours = resolveLearnedHours(state, NOW);
    expect(Option.getOrNull(hours)?.source).toBe('away');
    expect(findHours(hours, 2)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  test('a span that covers under half an hour does not count, and away wins over what you did', () => {
    const away = writeNights(listDays(6), 22, 8);
    for (const day of listDays(6)) {
      const start = at(day, 12);
      away[String(start)] = { from: start, to: start + 20 * 60 * 1000 };
    }
    const state = createActivity({ away, presence: writePresence(listDays(10), [3]) });
    const hours = resolveLearnedHours(state, NOW);
    expect(Option.getOrNull(hours)?.source).toBe('away');
    expect(isActiveAt(hours, at(1, 12))).toBe(true);
  });

  test('tells weekdays from the weekend once each weekday was seen twice', () => {
    const weekdays = listDays(21).filter((day) => {
      const weekday = resolveLocalSlot('UTC', at(day, 0)).weekday;
      return weekday >= 1 && weekday <= 5;
    });
    const hours = resolveLearnedHours(createActivity({ presence: writePresence(weekdays, WORK_HOURS) }), NOW);
    expect(findHours(hours, 1)).toEqual(WORK_HOURS);
    expect(findHours(hours, 6)).toEqual([]);
  });

  test('with too few days of a weekday, it uses every day you were seen', () => {
    const hours = resolveLearnedHours(createActivity({ presence: writePresence([1, 2, 3], [10]) }), NOW);
    for (let weekday = 0; weekday < 7; weekday++) expect(findHours(hours, weekday)).toEqual([10]);
  });

  test('recent days count more than older ones', () => {
    const away = writeNights(listDays(ACTIVE_HOURS_LIMITS.windowDays - 1), 0, 6);
    for (const day of listDays(13, 14)) {
      const start = at(day, 12);
      away[String(start)] = { from: start, to: start + HOUR_MS };
    }
    const hours = resolveLearnedHours(createActivity({ away }), NOW);
    expect(isActiveAt(hours, at(1, 12))).toBe(true);
    expect(isActiveAt(hours, at(1, 3))).toBe(false);
  });

  test('keeps the hour of your clock across a daylight saving change', () => {
    const presence: Record<string, number> = {};
    for (const day of listDays(20))
      presence[String(Math.floor(at(day, 8) / HOUR_MS) - (day > 12 ? 1 : 2))] = 1;
    const hours = resolveLearnedHours(createActivity({ presence, timeZone: 'Europe/Berlin' }), NOW);
    expect(findHours(hours, 1)).toEqual([8]);
  });

  test('gives the same answer again without learning twice', () => {
    const state = createActivity({ presence: writePresence(listDays(10), WORK_HOURS) });
    expect(Option.getOrNull(resolveLearnedHours(state, NOW))).toBe(
      Option.getOrNull(resolveLearnedHours(state, NOW + 1))
    );
  });
});

describe('the hours you set yourself', () => {
  test('win over what was learned', () => {
    const settings = { ...createSettings(), activeHours: [{ weekday: 1, from: 8, to: 12 }] };
    const state = createActivity({ settings, presence: writePresence(listDays(10), WORK_HOURS) });
    const hours = resolveActiveHours(state, NOW);
    expect(Option.getOrNull(hours)).toMatchObject({ source: 'override', timeZone: 'UTC', observedDays: 0 });
    expect(findHours(hours, 1)).toEqual([8, 9, 10, 11]);
    expect(findHours(hours, 2)).toEqual([]);
  });
});

describe('when your hours change next', () => {
  const hours = resolveLearnedHours(
    createActivity({ presence: writePresence(listDays(10), WORK_HOURS) }),
    NOW
  );

  test('is when your active hours end, or begin', () => {
    expect(resolveNextActiveChange(hours, at(0, 12))).toEqual(Option.some(at(0, 17)));
    expect(resolveNextActiveChange(hours, at(0, 20))).toEqual(Option.some(at(-1, 9)));
  });

  test('is never when nothing is known or nothing changes', () => {
    expect(isActiveAt(Option.none(), NOW)).toBe(true);
    expect(resolveNextActiveChange(Option.none(), NOW)).toEqual(Option.none());
    const always: ActiveHours = {
      source: 'override',
      timeZone: 'UTC',
      week: Array(WEEK_SLOTS).fill(true),
      observedDays: 0,
    };
    expect(resolveNextActiveChange(Option.some(always), NOW)).toEqual(Option.none());
  });

  test('comes round even for a single active hour a week', () => {
    const odd: ActiveHours = {
      source: 'override',
      timeZone: 'UTC',
      week: Array.from({ length: WEEK_SLOTS }, (_, slot) => slot === 0),
      observedDays: 0,
    };
    expect(Option.isSome(resolveNextActiveChange(Option.some(odd), NOW))).toBe(true);
  });
});

describe('the clock of your Mac', () => {
  test('records its time zone once, and refuses one that is not a time zone', () => {
    const harness = createHarness();
    harness.send({ type: 'clock.record', timeZone: 'Europe/Berlin' });
    expect(harness.state.timeZone).toBe('Europe/Berlin');
    const seq = harness.state.seq;
    harness.send({ type: 'clock.record', timeZone: 'Europe/Berlin' });
    expect(harness.state.seq).toBe(seq);
    expect(() => harness.send({ type: 'clock.record', timeZone: 'Mars/Olympus' })).toThrow('not a time zone');
  });
});

describe('setting your hours', () => {
  test('takes days of whole hours and clears them with null', () => {
    const harness = createHarness();
    const activeHours = [
      { weekday: 1, from: 9, to: 12 },
      { weekday: 1, from: 13, to: 18 },
    ];
    harness.send({ type: 'settings.change', patch: { activeHours } });
    expect(harness.state.settings.activeHours).toEqual(activeHours);
    harness.send({ type: 'settings.change', patch: { activeHours: null } });
    expect(harness.state.settings.activeHours).toBeNull();
  });

  test.each([
    [{ weekday: 7, from: 9, to: 12 }],
    [{ weekday: 1, from: 12, to: 12 }],
    [{ weekday: 1, from: 9, to: 25 }],
    [{ weekday: 1, from: 9.5, to: 12 }],
  ])('refuses a day outside the week or the clock: %o', (day) => {
    expect(() => createHarness().send({ type: 'settings.change', patch: { activeHours: [day] } })).toThrow(
      'Active hours'
    );
  });

  test('refuses two spans of one day that overlap', () => {
    const activeHours = [
      { weekday: 2, from: 9, to: 13 },
      { weekday: 2, from: 12, to: 18 },
    ];
    expect(() => createHarness().send({ type: 'settings.change', patch: { activeHours } })).toThrow(
      'overlaps'
    );
  });
});
