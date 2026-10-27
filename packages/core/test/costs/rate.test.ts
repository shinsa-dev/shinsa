import { describe, expect, test } from 'bun:test';
import type { UsageShareState } from '../../src/costs/rate.ts';
import {
  DAY_MS,
  type Run,
  type RunMeter,
  resolveMeterWindow,
  resolveUsageRates,
  resolveUsageShares,
  USAGE_RATE_LIMITS,
} from '../../src/index.ts';

type Reading = [percent: number, at: number, resetsAt?: number];

const WORK = 'account:work';
const SPARE = 'account:spare';

function createMeter(window: string, from: number, to: number, costUsd: number | null, readings: Reading[]) {
  return {
    attemptId: `${window}-${from}`,
    window,
    from,
    to,
    usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd },
    readings: readings.map(([percent, at, resetsAt]) => ({ percent, at, resetsAt: resetsAt ?? null })),
  } satisfies RunMeter;
}

function createRun(id: string, meters: RunMeter[], overrides: Partial<Run> = {}): Run {
  return {
    id,
    taskId: `task-${id}`,
    role: 'agent',
    purpose: 'build',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: meters[0]?.from ?? 0,
    endedAt: meters.at(-1)?.to ?? null,
    outcome: 'completed',
    summary: null,
    attempts: meters.map((meter) => ({
      attemptId: meter.attemptId,
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: meter.from,
    })),
    meters,
    ...overrides,
  };
}

interface Sequence {
  window?: string;
  count: number;
  costUsd: number;
  movement: number;
  start?: number;
  prefix?: string;
}

function createSequence({ window = WORK, count, costUsd, movement, start = 0, prefix = window }: Sequence) {
  return Array.from({ length: count }, (_, index) => {
    const from = start + index * 1_000;
    return createRun(`${prefix}-${index}`, [
      createMeter(window, from, from + 100, costUsd, [
        [index * movement, from],
        [(index + 1) * movement, from + 100],
      ]),
    ]);
  });
}

function toRuns(runs: Run[]) {
  return Object.fromEntries(runs.map((run) => [run.id, run]));
}

function describeShare(share: UsageShareState) {
  if (typeof share !== 'object') return share;
  const percent = Number(share.percent.toFixed(4));
  return share.trusted ? percent : `~${percent}`;
}

function resolveShares(...runs: Run[]) {
  const shares = resolveUsageShares(toRuns(runs));
  return Object.fromEntries([...shares].map(([id, share]) => [id, describeShare(share)]));
}

const LEARNED = createSequence({ count: USAGE_RATE_LIMITS.minTasks, costUsd: 10, movement: 2 });

describe('the weekly window a run is charged against', () => {
  test('is its attempt’s account, or the provider’s own login when it had none', () => {
    expect(resolveMeterWindow({ account: { id: 'work', email: null }, provider: 'claude' })).toBe(WORK);
    expect(resolveMeterWindow({ provider: 'codex' })).toBe('provider:codex');
  });
});

describe('resolveUsageShares', () => {
  test('with no readings yet, no run has a share', () => {
    expect(resolveShares()).toEqual({});
    const keyed = createRun('keyed', [createMeter('provider:claude', 0, 100, 2, [])]);
    const once = createRun('once', [createMeter(WORK, 0, 100, 2, [[3, 50]])]);
    expect(resolveShares(keyed, once)).toEqual({});
  });

  test('a few tasks are not enough to trust the rate: their runs carry an early estimate', () => {
    const few = createSequence({ count: USAGE_RATE_LIMITS.minTasks - 1, costUsd: 10, movement: 4 });
    expect(Object.values(resolveShares(...few))).toEqual(['~4', '~4', '~4', '~4']);
    const quiet = createSequence({ count: 8, costUsd: 10, movement: 1 });
    expect(new Set(Object.values(resolveShares(...quiet)))).toEqual(new Set(['~1']));
    expect(resolveUsageRates(toRuns(few)).get(WORK)).toEqual({
      percentPerUsd: 0.4,
      tasks: 4,
      trusted: false,
    });
  });

  test('a window whose readings taught nothing yet has no estimate, so its runs are learning', () => {
    const idle = createRun('idle', [
      createMeter(WORK, 30 * 60_000, 30 * 60_000 + 100, 1, [
        [10, 0],
        [60, 30 * 60_000 + 100],
      ]),
    ]);
    expect(resolveShares(idle)).toEqual({ idle: 'learning' });
    expect(resolveUsageRates(toRuns([idle])).get(WORK)).toBeNull();
  });

  test('once enough tasks moved the account, every run’s share is its cost at the learned rate', () => {
    const shares = resolveUsageShares(toRuns(LEARNED));
    expect([...shares.values()]).toEqual(
      Array(5).fill({ percent: expect.closeTo(2, 9), tasks: 5, trusted: true })
    );
  });

  test('many tasks: whole-percent readings even out into one rate', () => {
    const runs = Array.from({ length: 20 }, (_, index) => {
      const from = index * 1_000;
      const before = Math.floor(index * 0.75);
      const after = Math.floor((index + 1) * 0.75);
      return createRun(`run-${index}`, [
        createMeter(WORK, from, from + 100, 5, [
          [before, from],
          [after, from + 100],
        ]),
      ]);
    });
    const shares = resolveShares(...runs);
    expect(shares['run-19']).toBeCloseTo(0.75, 1);
  });

  test('every run is charged at the account’s current rate, so earlier tasks follow what was learned since', () => {
    expect(resolveShares(...LEARNED)[`${WORK}-0`]).toBe(2);
    const later = createSequence({ count: 5, costUsd: 10, movement: 6, start: 10_000, prefix: 'later' });
    const after = resolveShares(...LEARNED, ...later);
    for (const run of [...LEARNED, ...later]) expect(after[run.id]).toBe(4);
  });

  test('runs from before any readings take the current rate too', () => {
    const early = createRun('early', [createMeter(WORK, -50_000, -49_000, 3, [])]);
    expect(resolveShares(early, ...LEARNED).early).toBe(0.6);
  });

  test('a rate that changes over time is followed, weighted towards recent tasks', () => {
    const later = createSequence({
      count: 10,
      costUsd: 10,
      movement: 8,
      start: 60 * DAY_MS,
      prefix: 'later',
    });
    const shares = resolveShares(...LEARNED, ...later);
    expect(shares[`${WORK}-0`] as number).toBeGreaterThan(7.9);
    expect(shares[`${WORK}-0`]).toBe(shares['later-9'] as number);
  });

  test('runs at once on one account are each charged their own cost, so the shares add up to what it moved', () => {
    const together = Array.from({ length: 5 }, (_, index) =>
      createRun(`together-${index}`, [
        createMeter(WORK, 0, 100, index + 1, [
          [10, 0],
          [13, 100],
        ]),
      ])
    );
    const shares = resolveShares(...together);
    expect(shares).toEqual({
      'together-0': 0.2,
      'together-1': 0.4,
      'together-2': 0.6,
      'together-3': 0.8,
      'together-4': 1,
    });
    expect(Object.values(shares).reduce((sum: number, share) => sum + (share as number), 0)).toBeCloseTo(3);
  });

  test('two accounts on different plans each learn their own rate, and a new account starts learning', () => {
    const big = createSequence({ window: SPARE, count: 5, costUsd: 10, movement: 8 });
    const shares = resolveShares(...LEARNED, ...big);
    expect(shares[`${WORK}-0`]).toBe(2);
    expect(shares[`${SPARE}-0`]).toBe(8);
    const fresh = createSequence({ window: 'account:fresh', count: 1, costUsd: 10, movement: 1 });
    expect(resolveShares(...LEARNED, ...fresh)['account:fresh-0']).toBe('~1');
  });

  test('a run that switched accounts is charged at each account’s rate, and is an estimate while one is learning', () => {
    const big = createSequence({ window: SPARE, count: 5, costUsd: 10, movement: 8 });
    const switched = createRun('switched', [
      createMeter(WORK, 20_000, 20_050, 1, []),
      createMeter(SPARE, 20_050, 20_100, 1, []),
    ]);
    expect(resolveShares(...LEARNED, ...big, switched).switched).toBe(1);
    const fresh = createSequence({ window: SPARE, count: 1, costUsd: 10, movement: 1 });
    expect(resolveShares(...LEARNED, ...fresh, switched).switched).toBe('~0.3');
  });

  test('a window that reset, a reading that dipped and movement while nothing ran teach nothing', () => {
    const reset = createRun('reset', [
      createMeter(WORK, 20_000, 20_100, 1, [
        [95, 20_000, 20_050],
        [40, 20_100, 600_000],
      ]),
    ]);
    const dipped = createRun('dipped', [
      createMeter(WORK, 21_000, 21_100, 1, [
        [78, 21_000],
        [10, 21_100],
      ]),
    ]);
    const idle = createRun('idle', [
      createMeter(WORK, 30 * 60_000, 30 * 60_000 + 100, 1, [
        [10, 0],
        [60, 30 * 60_000 + 100],
      ]),
    ]);
    expect(resolveShares(...LEARNED, reset, dipped, idle)).toMatchObject({
      reset: 0.2,
      dipped: 0.2,
      idle: 0.2,
    });
  });

  test('a movement shared with a run still working waits until that run is metered', () => {
    const working = createRun('working', [], {
      status: 'running',
      endedAt: null,
      attempts: [
        {
          attemptId: 'w1',
          provider: 'claude',
          model: null,
          resumed: false,
          handoff: null,
          startedAt: 0,
          account: { id: 'work', email: null },
        },
      ],
    });
    expect(new Set(Object.values(resolveShares(...LEARNED, working)))).toEqual(new Set(['learning']));
    expect(resolveShares(...LEARNED, { ...working, resumePending: true })[`${WORK}-0`]).toBe(2);
    const metered = createRun('metered', [createMeter(WORK, 4_100, 4_200, 0, [])], {
      status: 'running',
      endedAt: null,
    });
    expect(resolveShares(...LEARNED, metered)).toMatchObject({ [`${WORK}-0`]: 2, metered: 0 });
  });

  test('a run without a price has no share, and a movement it shared teaches nothing', () => {
    const unpriced = createRun('unpriced', [
      createMeter(WORK, 0, 100, null, [
        [0, 0],
        [40, 100],
      ]),
    ]);
    const runs = createSequence({ count: USAGE_RATE_LIMITS.minTasks + 1, costUsd: 10, movement: 2 });
    const shares = resolveShares(...runs, unpriced);
    expect(shares.unpriced).toBeUndefined();
    expect(shares[`${WORK}-0`]).toBe(2);
  });

  test('a movement no cost explains teaches nothing, and a run that cost nothing is charged nothing', () => {
    const free = createRun('free', [
      createMeter(WORK, 20_000, 20_100, 0, [
        [0, 20_000],
        [30, 20_100],
      ]),
    ]);
    expect(resolveShares(...LEARNED, free)).toMatchObject({ [`${WORK}-0`]: 2, free: 0 });
  });

  test('a run that never ran is left out, and the shares are worked out once per set of runs', () => {
    expect(resolveShares(createRun('queued', [], { attempts: undefined, meters: undefined }))).toEqual({});
    const runs = toRuns(LEARNED);
    expect(resolveUsageShares(runs)).toBe(resolveUsageShares(runs));
    expect(resolveUsageRates(runs)).toBe(resolveUsageRates(runs));
  });
});
