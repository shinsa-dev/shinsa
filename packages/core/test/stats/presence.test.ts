import { describe, expect, test } from 'bun:test';
import {
  HOUR_MS,
  type HourOfWeek,
  measureOnYourClock,
  PRESENCE_PROFILE_WEEKS,
  resolveHourWeight,
  resolvePresenceProfile,
  resolveYourClock,
  WEEK_HOURS,
} from '../../src/index.ts';

const DAY_HOURS = 24;
const hourOf: HourOfWeek = (time) => Math.floor(time / HOUR_MS) % WEEK_HOURS;
const START_WEEK = 10;

function at(day: number, hour: number) {
  return (START_WEEK * WEEK_HOURS + day * DAY_HOURS + hour) * HOUR_MS;
}

function workdays(days: number, from = 0) {
  const presence: Record<string, number> = {};
  for (let day = from; day < from + days; day += 1) {
    for (let hour = 9; hour < 18; hour += 1) presence[String(at(day, hour) / HOUR_MS)] = 2;
  }
  return presence;
}

const WEEKS_DAYS = PRESENCE_PROFILE_WEEKS * 7;
const NOW = at(WEEKS_DAYS, 0);

describe('your hour-of-week profile', () => {
  test('counts your usual working hours fully, nights not at all and the edges of your day in part', () => {
    const profile = resolvePresenceProfile(workdays(WEEKS_DAYS), NOW, hourOf);
    expect(profile).toHaveLength(WEEK_HOURS);
    expect(profile[hourOf(at(3, 12))]).toBe(1);
    expect(profile[hourOf(at(3, 3))]).toBe(0);
    expect(profile[hourOf(at(3, 8))]).toBe(0.25);
    expect(profile[hourOf(at(3, 18))]).toBe(0.25);
  });

  test('counts every hour fully when you have never acted', () => {
    const profile = resolvePresenceProfile({}, NOW, hourOf);
    expect(profile.every((weight) => weight === 1)).toBe(true);
  });

  test('learns only from the last weeks, and from less when your history is shorter', () => {
    const old = { [String(at(-20 * 7, 3) / HOUR_MS)]: 5 };
    const profile = resolvePresenceProfile({ ...old, ...workdays(7, WEEKS_DAYS - 7) }, NOW, hourOf);
    expect(profile[hourOf(at(3, 12))]).toBe(1);
    expect(profile[hourOf(at(3, 3))]).toBe(0);
  });

  test('weighs an hour you act in only some weeks below the hours you always work', () => {
    const presence = workdays(WEEKS_DAYS);
    for (let week = 0; week < 4; week += 1) presence[String(at(week * 7 + 2, 20) / HOUR_MS)] = 1;
    const profile = resolvePresenceProfile(presence, NOW, hourOf);
    expect(profile[hourOf(at(2, 20))]).toBeCloseTo(0.25);
  });
});

describe('a span on your clock', () => {
  const clock = resolveYourClock(workdays(WEEKS_DAYS), NOW, hourOf);

  test('counts a question asked at 23:00 and answered at 09:30 as 45 minutes', () => {
    const span = { from: at(WEEKS_DAYS - 7, 23), to: at(WEEKS_DAYS - 6, 9) + 30 * 60_000 };
    expect(measureOnYourClock(clock, span)).toBe(45 * 60_000);
  });

  test('counts a working afternoon in full', () => {
    expect(measureOnYourClock(clock, { from: at(5, 13), to: at(5, 17) })).toBe(4 * HOUR_MS);
  });

  test('counts a week away as nothing but the edges of the days around it', () => {
    const away = resolveYourClock({ ...workdays(7), ...workdays(7, 14) }, at(21, 0), hourOf);
    const span = { from: at(6, 17), to: at(14, 10) };
    expect(measureOnYourClock(away, span)).toBe(HOUR_MS + 0.25 * HOUR_MS + 0.25 * HOUR_MS + HOUR_MS);
  });

  test('counts an hour you acted in fully, even at night, and the hours beside it in part', () => {
    const night = resolveYourClock({ ...workdays(7), [String(at(3, 3) / HOUR_MS)]: 1 }, at(7, 0), hourOf);
    expect(resolveHourWeight(night, at(3, 3) / HOUR_MS)).toBe(1);
    expect(measureOnYourClock(night, { from: at(3, 2), to: at(3, 5) })).toBe(1.5 * HOUR_MS);
  });

  test('uses your usual hours for time before anything you did was kept', () => {
    expect(measureOnYourClock(clock, { from: at(-3, 12), to: at(-3, 14) })).toBe(2 * HOUR_MS);
    expect(measureOnYourClock(clock, { from: at(-3, 2), to: at(-3, 4) })).toBe(0);
  });

  test('counts an empty or reversed span as nothing', () => {
    expect(measureOnYourClock(clock, { from: at(5, 13), to: at(5, 13) })).toBe(0);
    expect(measureOnYourClock(clock, { from: at(5, 14), to: at(5, 13) })).toBe(0);
  });

  test('counts wall clock when you have never acted', () => {
    const empty = resolveYourClock({}, NOW, hourOf);
    expect(empty.firstHour).toBeNull();
    expect(measureOnYourClock(empty, { from: at(5, 1), to: at(5, 4) })).toBe(3 * HOUR_MS);
  });
});
