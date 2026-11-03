import { describe, expect, test } from 'bun:test';
import {
  clipSpans,
  HOUR_MS,
  type HourOfWeek,
  listSummarizedTasks,
  resolveMedian,
  resolveTurnaround,
  type Round,
  serializeViewState,
  subtractSpans,
  type Task,
  type TaskTiming,
  type TurnaroundWindow,
  WEEK_HOURS,
} from '../../src/index.ts';
import { createHarness, createTask, registerRepo, shipAndMerge } from '../harness.ts';

const DAY = 24 * HOUR_MS;
const H = HOUR_MS;
const hourOf: HourOfWeek = (time) => Math.floor(time / HOUR_MS) % WEEK_HOURS;

function windowOf(count: number, now = count * DAY): TurnaroundWindow {
  return {
    days: Array.from({ length: count }, (_, index) => `d${index}`),
    dayOf: (at) => `d${Math.floor(at / DAY)}`,
    from: 0,
    hourOf,
    now,
  };
}

const BASE = (() => {
  const harness = createHarness();
  return harness.task(createTask(harness));
})();

function timing(overrides: Partial<TaskTiming> = {}): TaskTiming {
  return {
    paused: [],
    pausedSince: null,
    needsYou: [],
    needsYouSince: null,
    openGates: [],
    inputs: [],
    ...overrides,
  };
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    number: 1,
    title: 'Round',
    request: 'r',
    why: null,
    shipping: 'onto_pull_request',
    status: 'merged',
    pipeline: [],
    branch: 'b',
    base: null,
    pullRequest: null,
    queuedAt: 0,
    startedAt: 0,
    endedAt: 10 * H,
    outcome: null,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { ...BASE, id, rounds: [round()], timing: timing(), ...overrides };
}

function source(...tasks: Task[]) {
  return { tasks: Object.fromEntries(tasks.map((entry) => [entry.id, entry])), runs: {} };
}

describe('medians and spans', () => {
  test('takes the middle value, the mean of the two middle ones, or none', () => {
    expect(resolveMedian([5, 1, 3])).toBe(3);
    expect(resolveMedian([4, 1, 3, 2])).toBe(2.5);
    expect(resolveMedian([])).toBeNull();
  });

  test('clips spans to a window and cuts spans out of a span', () => {
    expect(
      clipSpans(
        [
          { from: 0, to: 5 },
          { from: 8, to: 9 },
        ],
        { from: 2, to: 7 }
      )
    ).toEqual([{ from: 2, to: 5 }]);
    expect(
      subtractSpans({ from: 0, to: 10 }, [
        { from: 6, to: 8 },
        { from: 1, to: 3 },
        { from: 12, to: 14 },
        { from: 2, to: 4 },
      ])
    ).toEqual([
      { from: 0, to: 1 },
      { from: 4, to: 6 },
      { from: 8, to: 10 },
    ]);
    expect(subtractSpans({ from: 0, to: 4 }, [{ from: 0, to: 4 }])).toEqual([]);
  });
});

describe('turnaround', () => {
  test('shows nothing when no round finished in the range', () => {
    expect(resolveTurnaround(source(), {}, windowOf(7))).toEqual({
      startToFinish: { median: null, count: 0 },
      agentTime: { median: null, count: 0 },
      yourTurnaround: { median: null, count: 0 },
      waitingShare: null,
    });
  });

  test('leaves paused time out and splits the rest between agents and you', () => {
    const paused = task('a', {
      timing: timing({
        paused: [{ from: 2 * H, to: 4 * H }],
        needsYou: [{ from: 5 * H, to: 7 * H, answered: true }],
      }),
    });
    const turnaround = resolveTurnaround(source(paused), {}, windowOf(7));
    expect(turnaround.startToFinish).toEqual({ median: 8 * H, count: 1 });
    expect(turnaround.agentTime).toEqual({ median: 6 * H, count: 1 });
    expect(turnaround.yourTurnaround).toEqual({ median: 2 * H, count: 1 });
    expect(turnaround.waitingShare).toBe(0.25);
  });

  test('never counts a wait on you twice when the task was snoozed during it', () => {
    const overlapping = task('a', {
      timing: timing({
        paused: [{ from: 3 * H, to: 6 * H }],
        needsYou: [{ from: 1 * H, to: 5 * H, answered: true }],
      }),
    });
    const turnaround = resolveTurnaround(source(overlapping), {}, windowOf(7));
    expect(turnaround.agentTime.median).toBe(5 * H);
    expect(turnaround.yourTurnaround.median).toBe(2 * H);
    expect(turnaround.startToFinish.median).toBe(7 * H);
  });

  test('cuts a pause or a wait still open at the end of the round', () => {
    const open = task('a', { timing: timing({ pausedSince: 8 * H, needsYouSince: 6 * H }) });
    const turnaround = resolveTurnaround(source(open), {}, windowOf(7));
    expect(turnaround.agentTime.median).toBe(6 * H);
    expect(turnaround.startToFinish.median).toBe(8 * H);
    expect(turnaround.yourTurnaround.count).toBe(0);
  });

  test('counts only finished rounds that ended in the range, and only waits you answered', () => {
    const rounds = task('a', {
      rounds: [
        round({ number: 1, endedAt: 2 * H }),
        round({ number: 2, status: 'finished', startedAt: 3 * H, endedAt: 7 * H }),
        round({ number: 3, status: 'cancelled' }),
        round({ number: 4, status: 'shipped' }),
        round({ number: 5, startedAt: null }),
        round({ number: 6, endedAt: 9 * DAY }),
      ],
      timing: timing({
        needsYou: [
          { from: 0, to: H, answered: true },
          { from: 3 * H, to: 4 * H, answered: false },
          { from: 8 * DAY, to: 8 * DAY + H, answered: true },
        ],
      }),
    });
    const turnaround = resolveTurnaround(source(rounds), {}, windowOf(7));
    expect(turnaround.startToFinish).toEqual({ median: 3 * H, count: 2 });
    expect(turnaround.yourTurnaround).toEqual({ median: H, count: 1 });
  });

  test('ends a task’s only round when the task closed', () => {
    const settled = task('a', { rounds: [], stage: 'merged', createdAt: 0, closedAt: 5 * H });
    expect(resolveTurnaround(source(settled), {}, windowOf(7)).startToFinish.median).toBe(5 * H);
  });

  test('measures waits on you on your clock, so a night away counts for little', () => {
    const presence: Record<string, number> = {};
    for (let day = 0; day < 56; day += 1) {
      for (let hour = 9; hour < 18; hour += 1) presence[String(day * 24 + hour)] = 1;
    }
    const asked = 54 * DAY + 23 * H;
    const answered = 55 * DAY + 9.5 * H;
    const night = task('a', {
      rounds: [round({ startedAt: asked - H, endedAt: answered + H })],
      timing: timing({ needsYou: [{ from: asked, to: answered, answered: true }] }),
    });
    const turnaround = resolveTurnaround(source(night), presence, windowOf(56, 56 * DAY));
    expect(turnaround.yourTurnaround.median).toBe(0.75 * H);
    expect(turnaround.agentTime.median).toBe(2 * H);
    expect(turnaround.startToFinish.median).toBe(2.75 * H);
  });

  test('reads the same from the summarized view a socket gets', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const merged = createTask(harness, { repoId, request: 'Ship the scroll fix' });
    shipAndMerge(harness, merged);
    const now = harness.state.tasks[merged]?.closedAt ?? 0;
    const window = { ...windowOf(1, now + DAY), dayOf: () => 'd0' };
    const view = serializeViewState(harness.state, listSummarizedTasks(harness.state));
    const full = resolveTurnaround(harness.state, harness.state.presence, window);
    expect(full.startToFinish.count).toBe(1);
    expect(resolveTurnaround(view, harness.state.presence, window)).toEqual(full);
  });
});
