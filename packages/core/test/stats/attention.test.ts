import { describe, expect, test } from 'bun:test';
import {
  type GateDecision,
  type GateType,
  HOUR_MS,
  type HourOfWeek,
  isHandsOff,
  listGoingSpans,
  mergeSpans,
  resolveAttention,
  resolveFirstReview,
  resolveWeightedMedian,
  resolveYourClock,
  type Round,
  type Task,
  type TaskTiming,
  type TurnaroundWindow,
  WEEK_HOURS,
  type YourInput,
} from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

const DAY = 24 * HOUR_MS;
const H = HOUR_MS;
const hourOf: HourOfWeek = (time) => Math.floor(time / HOUR_MS) % WEEK_HOURS;
const NOBODY = { tasks: {} };
const CLOCK = resolveYourClock(NOBODY, 0, hourOf);

function windowOf(count: number, now = count * DAY, from = 0): TurnaroundWindow {
  return {
    days: Array.from({ length: count }, (_, index) => `d${index}`),
    dayOf: (at) => `d${Math.floor(at / DAY)}`,
    from,
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

function gate(at: number, type: GateType, decision: GateDecision): YourInput {
  return { at, kind: 'gate', gate: type, decision };
}

function message(at: number): YourInput {
  return { at, kind: 'message' };
}

describe('tasks at once', () => {
  test('takes the median of how many tasks had a round going, weighted by time, and the peak', () => {
    const short = task('b', { rounds: [round({ endedAt: 4 * H })] });
    expect(resolveAttention(source(task('a'), short), NOBODY, windowOf(1)).tasksAtOnce).toEqual({
      median: 1,
      peak: 2,
    });
    const long = task('b', { rounds: [round({ endedAt: 6 * H })] });
    expect(resolveAttention(source(task('a'), long), NOBODY, windowOf(1)).tasksAtOnce).toEqual({
      median: 2,
      peak: 2,
    });
  });

  test('leaves out a task set aside by your focus on another project, and time away from your Mac', () => {
    const you = {
      tasks: {},
      away: { a: { from: 8 * H, to: 10 * H } },
      focusHistory: { f: { projectIds: ['a'], except: false, from: 0, to: 4 * H, until: null } },
    };
    const clock = resolveYourClock(you, DAY, hourOf);
    expect(listGoingSpans(task('b', { projectId: 'b' }), clock, windowOf(1))).toEqual([
      { from: 0, to: 0.5 * H },
      { from: 4 * H, to: 10 * H },
    ]);
    const attention = resolveAttention(
      source(task('a', { projectId: 'a' }), task('b', { projectId: 'b' })),
      you,
      windowOf(1)
    );
    expect(attention.tasksAtOnce).toEqual({ median: 2, peak: 2 });
  });

  test('leaves out paused time, rounds that never started and time before the range', () => {
    const paused = task('b', {
      rounds: [round({ endedAt: 6 * H })],
      timing: timing({ paused: [{ from: 0, to: 4 * H }] }),
    });
    const waiting = task('c', { rounds: [round({ status: 'waiting', startedAt: null, endedAt: null })] });
    expect(listGoingSpans(paused, CLOCK, windowOf(1))).toEqual([{ from: 4 * H, to: 6 * H }]);
    expect(listGoingSpans(waiting, CLOCK, windowOf(1))).toEqual([]);
    expect(listGoingSpans(task('a'), CLOCK, windowOf(1, DAY, 8 * H))).toEqual([{ from: 8 * H, to: 10 * H }]);
  });

  test('counts a round still going until now, and a finished one without an end until the task closed', () => {
    const going = task('a', { rounds: [round({ status: 'active', endedAt: null })] });
    const closed = task('b', { rounds: [round({ status: 'finished', endedAt: null })], closedAt: 3 * H });
    expect(listGoingSpans(going, CLOCK, windowOf(1, 5 * H))).toEqual([{ from: 0, to: 5 * H }]);
    expect(listGoingSpans(closed, CLOCK, windowOf(1))).toEqual([{ from: 0, to: 3 * H }]);
  });

  test('counts a task once while two of its rounds overlap', () => {
    const twice = task('a', { rounds: [round(), round({ number: 2, startedAt: 5 * H, endedAt: 12 * H })] });
    expect(listGoingSpans(twice, CLOCK, windowOf(1))).toEqual([{ from: 0, to: 12 * H }]);
    expect(
      mergeSpans([
        { from: 5, to: 8 },
        { from: 0, to: 4 },
        { from: 4, to: 6 },
      ])
    ).toEqual([{ from: 0, to: 8 }]);
  });

  test('has no median while nothing was going or you were away, but keeps the peak', () => {
    expect(resolveAttention(source(), NOBODY, windowOf(1)).tasksAtOnce).toEqual({ median: null, peak: null });
    const away = resolveAttention(
      source(task('a'), task('b')),
      { tasks: {}, presence: { '500': 1 } },
      windowOf(30)
    );
    expect(away.tasksAtOnce).toEqual({ median: null, peak: 2 });
    expect(resolveWeightedMedian([])).toBeNull();
    expect(
      resolveWeightedMedian([
        { count: 3, weight: 1 },
        { count: 1, weight: 1 },
        { count: 2, weight: 1 },
      ])
    ).toBe(2);
  });
});

describe('your input per round', () => {
  const approvals = task('a', {
    timing: timing({
      inputs: [
        gate(H, 'plan', 'approve'),
        gate(9 * H, 'review', 'approve'),
        gate(10 * H, 'merge', 'approve'),
      ],
    }),
  });
  const involved = task('b', {
    timing: timing({
      inputs: [
        message(0),
        gate(2 * H, 'question', 'reply'),
        message(3 * H),
        gate(5 * H, 'review', 'revise'),
        gate(8 * H, 'review', 'approve'),
        message(11 * H),
      ],
    }),
  });
  const untouched = task('c');

  test('counts the inputs, questions, messages and first review decisions of each finished round', () => {
    const attention = resolveAttention(source(approvals, involved, untouched), NOBODY, windowOf(1));
    expect(attention).toMatchObject({
      rounds: 3,
      inputsPerRound: { median: 3, count: 3 },
      handsOffShare: 2 / 3,
      questionShare: 1 / 3,
      messagesPerRound: 1 / 3,
      approvedFirstTime: { share: 0.5, count: 2 },
    });
  });

  test('divides agent time by your inputs, at least one', () => {
    const attention = resolveAttention(source(approvals, involved, untouched), NOBODY, windowOf(1));
    expect(attention.agentTimePerInput).toEqual({ median: (10 * H) / 3, count: 3 });
  });

  test('counts a secret request as a question and a failure retry as not hands-off', () => {
    const secret = task('d', { timing: timing({ inputs: [gate(2 * H, 'secret', 'reply')] }) });
    const retried = task('e', { timing: timing({ inputs: [gate(2 * H, 'failure', 'approve')] }) });
    expect(resolveAttention(source(secret, retried), NOBODY, windowOf(1))).toMatchObject({
      rounds: 2,
      handsOffShare: 0,
      questionShare: 0.5,
    });
  });

  test('reads none without finished rounds', () => {
    const going = task('a', { rounds: [round({ status: 'active', endedAt: null })] });
    expect(resolveAttention(source(going), NOBODY, windowOf(1))).toMatchObject({
      rounds: 0,
      inputsPerRound: { median: null, count: 0 },
      agentTimePerInput: { median: null, count: 0 },
      handsOffShare: null,
      questionShare: null,
      messagesPerRound: null,
      approvedFirstTime: { share: null, count: 0 },
    });
  });

  test('a round is hands-off only when every input approved a plan, review or merge', () => {
    expect(isHandsOff([])).toBe(true);
    expect(isHandsOff([gate(1, 'merge', 'approve')])).toBe(true);
    expect(isHandsOff([gate(1, 'question', 'approve')])).toBe(false);
    expect(isHandsOff([gate(1, 'failure', 'approve')])).toBe(false);
    expect(isHandsOff([gate(1, 'sign_in', 'approve')])).toBe(false);
    expect(isHandsOff([gate(1, 'plan', 'revise')])).toBe(false);
    expect(isHandsOff([message(1)])).toBe(false);
    expect(resolveFirstReview([message(1), gate(2, 'plan', 'revise')])).toBeNull();
  });
});
