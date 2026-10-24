import { describe, expect, test } from 'bun:test';
import {
  isTimeZone,
  parseTimeOfDay,
  resolveFirstRun,
  resolveNextRun,
  serializeTimeOfDay,
} from '../../src/index.ts';
import { resolveZonedInstant } from '../../src/schedules/time.ts';

const MINUTE = 60_000;

const NEW_YORK = 'America/New_York';

describe('times of day', () => {
  test.each([
    ['09:00', { hour: 9, minute: 0 }],
    ['9:05', { hour: 9, minute: 5 }],
    [' 23:59 ', { hour: 23, minute: 59 }],
  ])('reads %s', (text, time) => {
    expect(parseTimeOfDay(text)).toEqual(time);
  });

  test.each(['24:00', '12:60', '9', 'noon', ''])('refuses %s', (text) => {
    expect(parseTimeOfDay(text)).toBeNull();
  });

  test('writes two digits each', () => {
    expect(serializeTimeOfDay({ hour: 7, minute: 3 })).toBe('07:03');
  });

  test('knows a time zone from a typo', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('Europe/Atlantis')).toBe(false);
  });
});

describe('a wall-clock time across daylight saving', () => {
  test('a time that does not exist when the clocks go forward moves on by the gap', () => {
    const at = resolveZonedInstant(NEW_YORK, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(new Date(at).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  test('a time that happens twice when the clocks go back is the first one', () => {
    const at = resolveZonedInstant(NEW_YORK, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    expect(new Date(at).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  test('a daily schedule stays at 09:00 over the spring change', () => {
    let at = Date.parse('2026-03-06T20:00:00Z');
    const runs: string[] = [];
    for (let day = 0; day < 4; day += 1) {
      at = resolveNextRun({ kind: 'daily', time: '09:00', weekdays: [] }, at, NEW_YORK) ?? 0;
      runs.push(new Date(at).toISOString());
    }
    expect(runs).toEqual([
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-10T13:00:00.000Z',
    ]);
  });

  test('a daily schedule in the repeated hour runs once that night', () => {
    let at = Date.parse('2026-10-31T20:00:00Z');
    const runs: string[] = [];
    for (let day = 0; day < 2; day += 1) {
      at = resolveNextRun({ kind: 'daily', time: '01:30', weekdays: [] }, at, NEW_YORK) ?? 0;
      runs.push(new Date(at).toISOString());
    }
    expect(runs).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });
});

describe('the next run', () => {
  const friday = Date.parse('2026-10-23T12:00:00Z');

  test('weekdays only skip the weekend', () => {
    const next = resolveNextRun({ kind: 'daily', time: '08:00', weekdays: [1, 2, 3, 4, 5] }, friday, 'UTC');
    expect(new Date(next ?? 0).toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  test('a weekday whose time has passed today waits a week', () => {
    const next = resolveNextRun({ kind: 'daily', time: '09:00', weekdays: [5] }, friday, 'UTC');
    expect(new Date(next ?? 0).toISOString()).toBe('2026-10-30T09:00:00.000Z');
  });

  test('a daily time later today runs today', () => {
    const next = resolveNextRun({ kind: 'daily', time: '13:00', weekdays: [] }, friday, 'UTC');
    expect(new Date(next ?? 0).toISOString()).toBe('2026-10-23T13:00:00.000Z');
  });

  test('a stored time or weekday that cannot occur never runs', () => {
    expect(resolveNextRun({ kind: 'daily', time: 'later', weekdays: [] }, friday, 'UTC')).toBeNull();
    expect(resolveNextRun({ kind: 'daily', time: '09:00', weekdays: [9] }, friday, 'UTC')).toBeNull();
  });

  test('an interval counts from the time given and never under a minute', () => {
    expect(resolveNextRun({ kind: 'interval', everyMinutes: 15 }, friday, 'UTC')).toBe(friday + 15 * MINUTE);
    expect(resolveNextRun({ kind: 'interval', everyMinutes: 0 }, friday, 'UTC')).toBe(friday + MINUTE);
  });

  test('a one-off runs once, a webhook never on a clock', () => {
    expect(resolveNextRun({ kind: 'once', at: friday + 1 }, friday, 'UTC')).toBe(friday + 1);
    expect(resolveNextRun({ kind: 'once', at: friday }, friday, 'UTC')).toBeNull();
    expect(resolveNextRun({ kind: 'webhook', signature: null, replayKey: null }, friday, 'UTC')).toBeNull();
  });

  test('the first run of a one-off keeps its own time', () => {
    expect(resolveFirstRun({ kind: 'once', at: friday - 1 }, friday, 'UTC')).toBe(friday - 1);
    expect(resolveFirstRun({ kind: 'interval', everyMinutes: 1 }, friday, 'UTC')).toBe(friday + MINUTE);
  });
});
