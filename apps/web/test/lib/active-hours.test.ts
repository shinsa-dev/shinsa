import { describe, expect, test } from 'bun:test';
import { type ActiveHours, DAY_HOURS, WEEK_SLOTS } from '@shinsa/core';
import {
  ACTIVE_HOURS_LABEL,
  describeActiveHoursSource,
  describeRanges,
  formatHour,
  listActiveHourRows,
  listFromItems,
  listToItems,
  readFromValue,
  resolveFromValue,
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
  test('starts from the learned hours, one span from first to last hour each day', () => {
    expect(
      resolveOverrideDays(
        createHours({
          1: [
            [9, 12],
            [14, 18],
          ],
          6: [[10, 11]],
        })
      )
    ).toEqual([
      { weekday: 1, from: 9, to: 18 },
      { weekday: 6, from: 10, to: 11 },
    ]);
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
