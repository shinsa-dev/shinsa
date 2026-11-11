import { describe, expect, test } from 'bun:test';
import { type ActiveHours, DAY_HOURS, WEEK_SLOTS } from '@shinsa/core';
import {
  ACTIVE_HOURS_LABEL,
  describeActiveHoursSource,
  describeNow,
  describeWeekTotal,
  describeRanges,
  formatHour,
  listActiveHourRows,
  listFromItems,
  listToItems,
  readFromValue,
  resolveFromValue,
  resolveNowMark,
  resolveOverrideDays,
  updateOverrideDay,
} from '@/lib/active-hours.ts';

function createHours(
  spans: Record<number, [number, number][]>,
  source: ActiveHours['source'] = 'activity'
): ActiveHours {
  const week = Array.from({ length: WEEK_SLOTS }, (_, slot) => {
    const hour = slot % DAY_HOURS;
    return (spans[Math.floor(slot / DAY_HOURS)] ?? []).some(([from, to]) => from <= hour && hour < to);
  });
  return { source, timeZone: 'Europe/Berlin', week, observedDays: 12 };
}

describe('your hours, read', () => {
  test('lists the week from Monday, each day its cells and its ranges', () => {
    const hours = createHours({
      1: [
        [9, 12],
        [13, 18],
      ],
      0: [],
    });
    const rows = listActiveHourRows(hours, null);
    expect(rows.map((row) => row.name)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(rows[0]?.ranges).toBe('09:00 to 12:00, 13:00 to 18:00');
    expect(rows[0]?.cells.filter((cell) => cell.active).map((cell) => cell.hour)).toEqual([
      9, 10, 11, 13, 14, 15, 16, 17,
    ]);
    expect(rows[6]?.ranges).toBe(ACTIVE_HOURS_LABEL.inactive);
    expect(rows[0]?.span).toBeNull();
  });

  test('a day set by hand carries its span', () => {
    const rows = listActiveHourRows(createHours({ 2: [[8, 16]] }, 'override'), [
      { weekday: 2, from: 8, to: 16 },
    ]);
    expect(rows[1]?.span).toEqual({ weekday: 2, from: 8, to: 16 });
    expect(rows[1]?.split).toBe(false);
  });

  test('a day set with two spans is marked, so the one-span editor never rewrites it', () => {
    const rows = listActiveHourRows(
      createHours(
        {
          3: [
            [9, 12],
            [14, 18],
          ],
        },
        'override'
      ),
      [
        { weekday: 3, from: 9, to: 12 },
        { weekday: 3, from: 14, to: 18 },
      ]
    );
    expect(rows[2]?.split).toBe(true);
    expect(rows[2]?.ranges).toBe('09:00 to 12:00, 14:00 to 18:00');
  });

  test('a day active until midnight ends at 24:00', () => {
    expect(describeRanges(Array.from({ length: DAY_HOURS }, (_, hour) => hour >= 20))).toBe('20:00 to 24:00');
    expect(formatHour(7)).toBe('07:00');
  });

  test('says where the hours come from, in its time zone', () => {
    expect(describeActiveHoursSource(createHours({}, 'away'))).toBe(
      'Learned from when you were away over 12 days, on Europe/Berlin time.'
    );
    expect(describeActiveHoursSource({ ...createHours({}), observedDays: 1 })).toBe(
      'Learned from what you did over 1 day, on Europe/Berlin time.'
    );
    expect(describeActiveHoursSource(createHours({}, 'override'))).toBe(
      'Set by hand, on Europe/Berlin time.'
    );
  });
});

describe('your hours, set by hand', () => {
  test('starts from the longest learned span of each day, never filling the gaps around it', () => {
    expect(
      resolveOverrideDays(
        createHours({
          1: [
            [1, 2],
            [7, 19],
          ],
          6: [[10, 11]],
        })
      )
    ).toEqual([
      { weekday: 1, from: 7, to: 19 },
      { weekday: 6, from: 10, to: 11 },
    ]);
  });

  test('keeps only the longest span of a day, so every day stays editable', () => {
    const days = resolveOverrideDays(
      createHours({
        2: [
          [0, 1],
          [9, 12],
          [13, 18],
          [20, 21],
        ],
      })
    );
    expect(days).toEqual([{ weekday: 2, from: 13, to: 18 }]);
    expect(listActiveHourRows(createHours({}), days).every((row) => !row.split)).toBe(true);
  });

  test('with nothing learned, starts from weekdays 9 to 17', () => {
    expect(resolveOverrideDays(null)).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, from: 9, to: 17 }))
    );
  });

  test('changing a day replaces its spans, and Off removes it', () => {
    const days = [
      { weekday: 3, from: 9, to: 12 },
      { weekday: 3, from: 13, to: 17 },
      { weekday: 1, from: 9, to: 17 },
    ];
    expect(updateOverrideDay(days, 3, { from: 10, to: 15 })).toEqual([
      { weekday: 1, from: 9, to: 17 },
      { weekday: 3, from: 10, to: 15 },
    ]);
    expect(updateOverrideDay(days, 3, null)).toEqual([{ weekday: 1, from: 9, to: 17 }]);
  });

  test('the start offers Off and every hour, the end every hour after the start', () => {
    expect(listFromItems().map((item) => item.value)).toEqual([
      'off',
      ...Array.from({ length: 24 }, (_, h) => String(h)),
    ]);
    expect(listToItems(21).map((item) => item.label)).toEqual(['22:00', '23:00', '24:00']);
    expect(resolveFromValue(null)).toBe('off');
    expect(resolveFromValue({ weekday: 1, from: 8, to: 12 })).toBe('8');
  });

  test('a new start keeps the end when it still comes after, else gives the day 8 hours', () => {
    const span = { weekday: 1, from: 9, to: 17 };
    expect(readFromValue('off', span)).toBeNull();
    expect(readFromValue('10', span)).toEqual({ from: 10, to: 17 });
    expect(readFromValue('18', span)).toEqual({ from: 18, to: 24 });
    expect(readFromValue('6', null)).toEqual({ from: 6, to: 14 });
  });
});

describe('the week timeline', () => {
  const MONDAY_NOON_BERLIN = Date.UTC(2026, 3, 13, 10, 30);

  test('totals the hours, and marks now on its weekday at its share of the day', () => {
    expect(describeWeekTotal(createHours({ 1: [[9, 10]] }))).toBe('1 hour a week');
    expect(describeWeekTotal(createHours({ 1: [[9, 17]], 2: [[9, 13]] }))).toBe('12 hours a week');
    expect(resolveNowMark(createHours({}), MONDAY_NOON_BERLIN)).toEqual({ weekday: 1, share: 12.5 / 24 });
  });

  test('says whether you are usually active now, and until when', () => {
    expect(describeNow(createHours({ 1: [[9, 17]] }), MONDAY_NOON_BERLIN)).toMatch(
      /^You are usually active now, until /
    );
    expect(describeNow(createHours({ 1: [[14, 17]] }), MONDAY_NOON_BERLIN)).toMatch(
      /^You are usually away now, until /
    );
    expect(describeNow(createHours({}), MONDAY_NOON_BERLIN)).toBe('You are not usually active.');
    const always = { ...createHours({}), week: Array<boolean>(WEEK_SLOTS).fill(true) };
    expect(describeNow(always, MONDAY_NOON_BERLIN)).toBe('You are usually active at any hour.');
  });

  test('gives each run its place on the day and a label', () => {
    const [monday] = listActiveHourRows(createHours({ 1: [[6, 12]] }), null);
    expect(monday?.runs).toEqual([
      { from: 6, to: 12, start: 0.25, width: 0.25, label: 'Monday, 06:00 to 12:00' },
    ]);
  });
});
