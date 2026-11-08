import { describe, expect, test } from 'bun:test';
import {
  FOCUS_GRACE_MS,
  type FocusSpan,
  HOUR_MS,
  type HourOfWeek,
  listSetAside,
  measureOnYourClock,
  PRESENCE_PROFILE_WEEKS,
  resolveHourWeight,
  resolvePresenceProfile,
  resolveYourClock,
  type Task,
  WEEK_HOURS,
  type YourInput,
} from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

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
  const clock = resolveYourClock({ tasks: {}, presence: workdays(WEEKS_DAYS) }, NOW, hourOf);

  test('counts a question asked at 23:00 and answered at 09:30 as 45 minutes', () => {
    const span = { from: at(WEEKS_DAYS - 7, 23), to: at(WEEKS_DAYS - 6, 9) + 30 * 60_000 };
    expect(measureOnYourClock(clock, span)).toBe(45 * 60_000);
  });

  test('counts a working afternoon in full', () => {
    expect(measureOnYourClock(clock, { from: at(5, 13), to: at(5, 17) })).toBe(4 * HOUR_MS);
  });

  test('counts a week away as nothing but the edges of the days around it', () => {
    const away = resolveYourClock(
      { tasks: {}, presence: { ...workdays(7), ...workdays(7, 14) } },
      at(21, 0),
      hourOf
    );
    const span = { from: at(6, 17), to: at(14, 10) };
    expect(measureOnYourClock(away, span)).toBe(HOUR_MS + 0.25 * HOUR_MS + 0.25 * HOUR_MS + HOUR_MS);
  });

  test('counts an hour you acted in fully, even at night, and the hours beside it in part', () => {
    const night = resolveYourClock(
      { tasks: {}, presence: { ...workdays(7), [String(at(3, 3) / HOUR_MS)]: 1 } },
      at(7, 0),
      hourOf
    );
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
    const empty = resolveYourClock({ tasks: {}, presence: {} }, NOW, hourOf);
    expect(empty.firstHour).toBeNull();
    expect(measureOnYourClock(empty, { from: at(5, 1), to: at(5, 4) })).toBe(3 * HOUR_MS);
  });
});

const BASE = (() => {
  const harness = createHarness();
  return harness.task(createTask(harness));
})();

function taskIn(projectId: string | null, inputs: YourInput[] = []): Task {
  return {
    ...BASE,
    id: projectId ?? 'none',
    projectId,
    timing: { paused: [], pausedSince: null, needsYou: [], needsYouSince: null, openGates: [], inputs },
  };
}

describe('time away from your Mac', () => {
  const day = at(5, 0);

  test('counts nothing while you were away, on top of your usual hours', () => {
    const away = { [String(at(5, 13))]: { from: at(5, 13), to: at(5, 15) } };
    const clock = resolveYourClock({ tasks: {}, presence: workdays(WEEKS_DAYS), away }, NOW, hourOf);
    expect(measureOnYourClock(clock, { from: at(5, 12), to: at(5, 17) })).toBe(3 * HOUR_MS);
    expect(clock.away).toEqual([{ from: at(5, 13), to: at(5, 15) }]);
  });

  test('ignores a span away in which you answered or messaged a task, from your phone say', () => {
    const away = {
      a: { from: day + HOUR_MS, to: day + 2 * HOUR_MS },
      b: { from: day + 3 * HOUR_MS, to: day + 4 * HOUR_MS },
    };
    const busy = taskIn('p', [
      { at: day + 1.5 * HOUR_MS, kind: 'message' },
      { at: day + 5 * HOUR_MS, kind: 'message' },
    ]);
    const clock = resolveYourClock({ tasks: { p: busy }, away }, NOW, hourOf);
    expect(clock.away).toEqual([{ from: day + 3 * HOUR_MS, to: day + 4 * HOUR_MS }]);
  });
});

describe('a task set aside by your focus', () => {
  const day = at(5, 0);

  function clockWith(focus: FocusSpan) {
    return resolveYourClock({ tasks: {}, focusHistory: { f: focus } }, NOW, hourOf);
  }

  test('sets aside a task in another project from 30 minutes into the focus until it ends', () => {
    const clock = clockWith({
      projectIds: ['a'],
      except: false,
      from: day,
      to: day + 4 * HOUR_MS,
      until: null,
    });
    expect(listSetAside(clock, taskIn('b'), NOW)).toEqual([
      { from: day + FOCUS_GRACE_MS, to: day + 4 * HOUR_MS },
    ]);
    expect(listSetAside(clock, taskIn(null), NOW)).toHaveLength(1);
    expect(listSetAside(clock, taskIn('a'), NOW)).toEqual([]);
  });

  test('ends a focus at its end time, or now while it lasts', () => {
    const timed = clockWith({
      projectIds: ['a'],
      except: false,
      from: day,
      to: null,
      until: day + 2 * HOUR_MS,
    });
    expect(listSetAside(timed, taskIn('b'), NOW)).toEqual([
      { from: day + FOCUS_GRACE_MS, to: day + 2 * HOUR_MS },
    ]);
    const open = clockWith({ projectIds: ['a'], except: false, from: day, to: null, until: null });
    expect(listSetAside(open, taskIn('b'), day + HOUR_MS)).toEqual([
      { from: day + FOCUS_GRACE_MS, to: day + HOUR_MS },
    ]);
  });

  test('a focus on all but some projects sets aside only the projects it leaves out', () => {
    const clock = clockWith({
      projectIds: ['a'],
      except: true,
      from: day,
      to: day + 4 * HOUR_MS,
      until: null,
    });
    expect(listSetAside(clock, taskIn('a'), NOW)).toHaveLength(1);
    expect(listSetAside(clock, taskIn('b'), NOW)).toEqual([]);
    expect(listSetAside(clock, taskIn(null), NOW)).toEqual([]);
  });

  test('reads a focus an older engine recorded on one project', () => {
    const older = { projectId: 'a', from: day, to: day + 4 * HOUR_MS, until: null } as unknown as FocusSpan;
    expect(listSetAside(clockWith(older), taskIn('b'), NOW)).toHaveLength(1);
    expect(listSetAside(clockWith(older), taskIn('a'), NOW)).toEqual([]);
  });

  test('sets nothing aside for a focus shorter than 30 minutes, so a quick switch changes nothing', () => {
    const quick = clockWith({
      projectIds: ['a'],
      except: false,
      from: day,
      to: day + FOCUS_GRACE_MS,
      until: null,
    });
    expect(listSetAside(quick, taskIn('b'), NOW)).toEqual([]);
  });

  test('sets nothing aside for a task you answered or messaged during the focus', () => {
    const clock = clockWith({
      projectIds: ['a'],
      except: false,
      from: day,
      to: day + 4 * HOUR_MS,
      until: null,
    });
    const answered = taskIn('b', [
      { at: day + 3 * HOUR_MS, kind: 'gate', gate: 'question', decision: 'reply' },
    ]);
    expect(listSetAside(clock, answered, NOW)).toEqual([]);
  });
});
