import { describe, expect, it } from 'bun:test';
import { HOUR_MS, type Run, type RunMeter, resolveUsageForecast, type ShinsaState } from '@shinsa/core';
import {
  describeRecentPace,
  describeSafePace,
  describeSegment,
  describeTightest,
  formatForecastDay,
  formatPace,
  isPaceApplied,
  listForecastDays,
  listForecastLanes,
  listProviderForecasts,
  resolveForecastPaths,
  resolveForecastShare,
  resolveRecentPace,
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
      /^Tightest point: at .+% a day you have .+% left across accounts just before (work|home)@example\.com resets in (15h|2\.6d)(, and the next one is .+ later)?\.$/
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
    expect(describeTightest(lone, NOW)).toMatch(/^Tightest point: at .+ just before work resets in 15h\.$/);
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
    const lanes = listForecastLanes(forecast);
    expect(lanes.map((lane) => lane.account.id)).toEqual(['work', 'home']);
    expect(lanes[0]?.segments.map((segment) => segment.left)).toEqual([8, 100]);
    const later = lanes[0]?.segments[1];
    if (!later) throw new Error('expected a second stretch');
    expect(describeSegment(forecast, later, NOW)).toBe('work@example.com resets to 100% in 15h.');
    expect(describeSegment(forecast, lanes[0]?.segments[0] ?? later, NOW)).toBe(
      'work@example.com has 8% left until it resets in 15h.'
    );
    expect(describeSegment({ ...forecast, accounts: [] }, later, NOW)).toBe('work resets to 100% in 15h.');
    const open = { accountId: 'home', from: NOW, to: forecast.to, left: 21 };
    expect(describeSegment(forecast, open, NOW)).toBe('home@example.com has 21% left.');
  });

  it('draws what is left across accounts at the safe pace as a line over the week', () => {
    const paths = resolveForecastPaths(forecast, 700, 40);
    if (!paths) throw new Error('expected paths');
    const top = Math.max(...forecast.points.map((point) => point.left));
    const first = forecast.points[0];
    if (!first) throw new Error('expected a point');
    expect(paths.line.startsWith(`M 0 ${Number((40 - (first.left / top) * 40).toFixed(2))} L `)).toBe(true);
    expect(paths.line.split(' L ')).toHaveLength(forecast.points.length);
    expect(paths.area).toBe(`${paths.line} L 700 40 L 0 40 Z`);
    expect(resolveForecastPaths({ ...forecast, points: [] }, 700, 40)).toBeNull();
    const dry = forecast.points.map((point) => ({ ...point, left: 0 }));
    expect(resolveForecastPaths({ ...forecast, points: dry }, 700, 40)).toBeNull();
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
