import { describe, expect, it } from 'bun:test';
import {
  HOUR_MS,
  resolveForecastTimeline,
  type Run,
  type RunMeter,
  resolveUsageForecast,
  type ShinsaState,
} from '@shinsa/core';
import {
  describeOutages,
  describeRecentPace,
  describeSafePace,
  describeSegment,
  describeTightest,
  formatForecastDay,
  formatPace,
  isPaceApplied,
  listForecastDays,
  listForecastLanes,
  listForecastPaces,
  listOutageSpans,
  listProviderForecasts,
  resolveDefaultPace,
  resolveForecastShare,
  resolveRecentPace,
  resolveUsableShare,
  selectForecastPace,
} from '@/lib/accounts/forecast.ts';
import { createAccount, createSnapshot, createWindow } from '../../support/accounts.ts';
import { createShinsaState, NOW } from '../../support/state.ts';

const DAY = 24 * HOUR_MS;

function createMeter(id: string, window: string, costUsd: number): RunMeter {
  const to = NOW - HOUR_MS;
  const from = to - HOUR_MS;
  return {
    attemptId: id,
    window,
    from,
    to,
    usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd },
    readings: [
      { percent: 0, at: from, resetsAt: null },
      { percent: costUsd * 10, at: to, resetsAt: null },
    ],
  };
}

function createRun(id: string, meters: RunMeter[]): Run {
  return {
    id,
    taskId: 't',
    role: 'agent',
    purpose: 'build',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: NOW - 2 * HOUR_MS,
    endedAt: NOW - HOUR_MS,
    outcome: 'completed',
    summary: null,
    meters,
  };
}

function stateWithRuns(runs: Run[]): ShinsaState {
  const state = createShinsaState({});
  state.runs = Object.fromEntries(runs.map((run) => [run.id, run]));
  return state;
}

function weeklyAccount(id: string, usedPercent: number, resetsIn: number) {
  return createAccount({
    id,
    usage: {
      status: 'ok',
      windows: [createWindow({ id: `${id}-weekly`, kind: 'weekly', usedPercent, resetsAt: NOW + resetsIn })],
      detail: null,
      checkedAt: NOW,
      source: 'read',
    },
  });
}

const RUNS = stateWithRuns([
  createRun('a', [createMeter('a', 'account:work', 1)]),
  createRun('b', [createMeter('b', 'account:home', 0.5)]),
  createRun('c', [createMeter('c', 'provider:codex', 0.2)]),
]);

describe('the recent pace', () => {
  it('adds up the last 24 hours of each provider apart', () => {
    expect(resolveRecentPace(RUNS, 'claude', NOW)).toBeCloseTo(15, 6);
    expect(resolveRecentPace(RUNS, 'codex', NOW)).toBeCloseTo(2, 6);
    expect(resolveRecentPace(RUNS, 'gemini', NOW)).toBeNull();
  });
});

describe('the forecasts', () => {
  it('forecasts the Claude accounts together and each other provider alone', () => {
    const snapshot = createSnapshot({
      accounts: [weeklyAccount('work', 92, 15 * HOUR_MS), weeklyAccount('home', 79, 3 * DAY)],
      providers: [
        {
          provider: 'codex',
          label: 'Codex',
          status: 'signed_in',
          method: null,
          version: null,
          detail: null,
          fix: null,
          email: 'me@example.com',
          usage: weeklyAccount('codex', 2, 2 * HOUR_MS).usage,
        },
        {
          provider: 'gemini',
          label: 'Gemini',
          status: 'signed_out',
          method: null,
          version: null,
          detail: null,
          fix: null,
          usage: weeklyAccount('gemini', 2, 2 * HOUR_MS).usage,
        },
        {
          provider: 'other',
          label: 'Other',
          status: 'signed_in',
          method: null,
          version: null,
          detail: null,
          fix: null,
          usage: { ...weeklyAccount('other', 2, 2 * HOUR_MS).usage, windows: [] },
        },
      ],
    });
    const forecasts = listProviderForecasts(snapshot, RUNS, NOW);
    expect(forecasts.map((entry) => [entry.provider, entry.title])).toEqual([
      ['claude', 'Claude'],
      ['codex', 'Codex'],
    ]);
    expect(forecasts[0]?.forecast.accounts.map((account) => account.id)).toEqual(['work', 'home']);
    expect(forecasts[0]?.forecast.currentPace).toBeCloseTo(15, 6);
    expect(forecasts[1]?.forecast.accounts[0]?.label).toBe('me@example.com');
  });

  it('has nothing to forecast before the accounts are read or without a weekly window', () => {
    expect(listProviderForecasts(null, RUNS, NOW)).toEqual([]);
    expect(
      listProviderForecasts(createSnapshot({ accounts: [createAccount({ id: 'a' })] }), RUNS, NOW)
    ).toEqual([]);
    const login = {
      provider: 'codex',
      label: 'Codex',
      status: 'signed_in' as const,
      method: null,
      version: null,
      detail: null,
      fix: null,
      usage: weeklyAccount('codex', 2, 2 * HOUR_MS).usage,
    };
    expect(
      listProviderForecasts(createSnapshot({ providers: [login] }), RUNS, NOW)[0]?.forecast.accounts[0]?.label
    ).toBe('Codex');
  });
});

describe('the forecast in words', () => {
  const accounts = [
    { id: 'work', label: 'work@example.com', left: 8, resetsAt: NOW + 15 * HOUR_MS },
    { id: 'home', label: 'home@example.com', left: 21, resetsAt: NOW + 63 * HOUR_MS },
  ];

  it('gives the safe pace and the tightest point with the gap to the next reset', () => {
    const forecast = resolveUsageForecast(accounts, NOW, 40);
    if (!forecast) throw new Error('expected a forecast');
    expect(describeSafePace(forecast)).toBe(
      `Up to ${formatPace(forecast.safePace)} of a weekly limit a day keeps you going for the next 7 days.`
    );
    expect(describeTightest(forecast, NOW)).toMatch(
      /^Tightest point at the safe pace: .+% left just before (work|home)@example\.com resets in (15h|2\.6d)\.$/
    );
    expect(describeRecentPace(forecast, NOW)).toMatch(
      /^In the last 24 hours you used 40%\. At that pace every account runs out in .+\.$/
    );
  });

  it('says when the pool lasts, when nothing was measured and when every account is spent', () => {
    const lasting = resolveUsageForecast(accounts, NOW, 1);
    const unmeasured = resolveUsageForecast(accounts, NOW, null);
    const spent = resolveUsageForecast([{ id: 'x', label: 'x', left: 0, resetsAt: null }], NOW, null);
    if (!lasting || !unmeasured || !spent) throw new Error('expected forecasts');
    expect(describeRecentPace(lasting, NOW)).toBe(
      'In the last 24 hours you used 1%. At that pace your accounts last the week.'
    );
    expect(describeRecentPace(unmeasured, NOW)).toBe('No measured usage in the last 24 hours.');
    expect(describeSafePace(spent)).toBe('Every account is out of usage until the next reset.');
    expect(describeTightest(spent, NOW)).toBeNull();
  });

  it('names the account by its id when its label is gone, and a tightest point with no reset after it', () => {
    const forecast = resolveUsageForecast([accounts[0] as (typeof accounts)[number]], NOW, null);
    if (!forecast?.tightest) throw new Error('expected a tightest point');
    const lone = { ...forecast, resets: [forecast.tightest], accounts: [] };
    expect(describeTightest(lone, NOW)).toMatch(
      /^Tightest point at the safe pace: .+ left just before work resets in 15h\.$/
    );
  });

  it('knows whether the pace is already the daily limit', () => {
    const forecast = resolveUsageForecast(accounts, NOW, null);
    if (!forecast) throw new Error('expected a forecast');
    expect(isPaceApplied(forecast, forecast.safePace)).toBe(true);
    expect(isPaceApplied(forecast, null)).toBe(false);
    expect(isPaceApplied(forecast, undefined)).toBe(false);
  });

  it('formats a pace to one decimal place', () => {
    expect(formatPace(18.34)).toBe('18.3%');
    expect(formatPace(20)).toBe('20%');
  });
});

describe('the timeline', () => {
  const forecast = resolveUsageForecast(
    [
      { id: 'work', label: 'work@example.com', left: 8, resetsAt: NOW + 15 * HOUR_MS },
      { id: 'home', label: 'home@example.com', left: 21, resetsAt: NOW + 63 * HOUR_MS },
    ],
    NOW,
    null
  );
  if (!forecast) throw new Error('expected a forecast');

  it('draws one lane per account with its stretches between resets', () => {
    const lanes = listForecastLanes(forecast, resolveForecastTimeline(forecast, forecast.safePace));
    expect(lanes.map((lane) => lane.account.id)).toEqual(['work', 'home']);
    expect(lanes[0]?.segments.map((segment) => segment.left)).toEqual([8, 100]);
  });

  it('says when each stretch has usage and when it runs out', () => {
    const stretch = { accountId: 'work', from: NOW, to: NOW + 15 * HOUR_MS, left: 8, emptyAt: null };
    expect(describeSegment(forecast, stretch, NOW)).toBe(
      'work@example.com has 8% left until it resets in 15h.'
    );
    expect(describeSegment(forecast, { ...stretch, emptyAt: NOW + 5 * HOUR_MS }, NOW)).toBe(
      'work@example.com has 8% left and runs out in 5h at this pace.'
    );
    expect(describeSegment(forecast, { ...stretch, left: 0, emptyAt: NOW }, NOW)).toBe(
      'work@example.com is out of usage until it resets in 15h.'
    );
    const later = { accountId: 'work', from: NOW + 15 * HOUR_MS, to: forecast.to, left: 100, emptyAt: null };
    expect(describeSegment(forecast, later, NOW)).toBe('work@example.com resets to 100% in 15h.');
    expect(describeSegment({ ...forecast, accounts: [] }, later, NOW)).toBe('work resets to 100% in 15h.');
    expect(describeSegment(forecast, { ...later, emptyAt: NOW + 2 * DAY }, NOW)).toBe(
      'work@example.com resets to 100% in 15h and runs out in 2d at this pace.'
    );
    expect(describeSegment(forecast, { ...stretch, to: forecast.to }, NOW)).toBe(
      'work@example.com has 8% left.'
    );
  });

  it('fills each stretch as far as it has usage', () => {
    const stretch = { accountId: 'work', from: NOW, to: NOW + 10 * HOUR_MS, left: 8, emptyAt: null };
    expect(resolveUsableShare(stretch)).toBe(1);
    expect(resolveUsableShare({ ...stretch, emptyAt: NOW + 4 * HOUR_MS })).toBeCloseTo(0.4, 6);
    expect(resolveUsableShare({ ...stretch, emptyAt: NOW })).toBe(0);
    expect(resolveUsableShare({ ...stretch, to: NOW })).toBe(0);
  });

  it('offers the safe pace, the last 24 hours and two faster paces to draw the timeline at', () => {
    const paces = listForecastPaces({ ...forecast, safePace: 20, currentPace: 9 });
    expect(paces.map((pace) => [pace.value, pace.label, pace.pace])).toEqual([
      ['safe', 'Safe pace 20%', 20],
      ['recent', 'Last 24 hours 9%', 9],
      ['faster', '30%', 30],
      ['double', '40%', 40],
    ]);
    expect(listForecastPaces({ ...forecast, safePace: 0, currentPace: 0 }).map((pace) => pace.value)).toEqual(
      ['safe']
    );
    expect(selectForecastPace({ ...forecast, safePace: 20, currentPace: 9 }, 'double').pace).toBe(40);
    expect(selectForecastPace({ ...forecast, currentPace: null }, 'recent').value).toBe('safe');
    expect(resolveDefaultPace({ ...forecast, safePace: 20, currentPace: 9 })).toBe('safe');
    expect(resolveDefaultPace({ ...forecast, safePace: 20, currentPace: 30 })).toBe('recent');
    expect(resolveDefaultPace({ ...forecast, currentPace: null })).toBe('safe');
  });

  it('says how long every account is out of usage at once, and where', () => {
    expect(describeOutages({ pace: 10, segments: [], outages: [] }, NOW)).toBeNull();
    const outages = [
      { from: NOW + 12 * HOUR_MS, to: NOW + 24 * HOUR_MS },
      { from: NOW + 64 * HOUR_MS, to: NOW + 72 * HOUR_MS },
    ];
    expect(describeOutages({ pace: 60, segments: [], outages }, NOW)).toBe(
      'At 60% a day every account is out of usage for 20h in all, starting in 12h.'
    );
    expect(
      describeOutages({ pace: 60, segments: [], outages: [{ from: NOW, to: NOW + 2 * HOUR_MS }] }, NOW)
    ).toBe('At 60% a day every account is out of usage for 2h in all, starting now.');
    const [span] = listOutageSpans(forecast, [{ from: forecast.from, to: forecast.from + 3.5 * DAY }]);
    expect(span?.start).toBe(0);
    expect(span?.width).toBeCloseTo(0.5, 6);
  });

  it('places times on the week and marks each midnight', () => {
    expect(resolveForecastShare(forecast, forecast.from - 1)).toBe(0);
    expect(resolveForecastShare(forecast, forecast.to + 1)).toBe(1);
    expect(resolveForecastShare(forecast, forecast.from + 3.5 * DAY)).toBeCloseTo(0.5, 6);
    const days = listForecastDays(forecast);
    expect(days.length).toBeGreaterThanOrEqual(6);
    expect(days.length).toBeLessThanOrEqual(7);
    for (const day of days) expect(new Date(day.at).getHours()).toBe(0);
    expect(formatForecastDay(new Date(2026, 10, 5).getTime())).toBe('Thu');
  });
});
