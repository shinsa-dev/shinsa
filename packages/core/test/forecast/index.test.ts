import { describe, expect, test } from 'bun:test';
import {
  type AccountSummary,
  type AccountUsage,
  type ForecastAccount,
  FORECAST_LIMITS,
  HOUR_MS,
  listForecastAccounts,
  resolveForecastAccount,
  resolveUsageForecast,
} from '../../src/index.ts';

const NOW = 1_000 * HOUR_MS;

function account(id: string, left: number, resetsInHours: number | null): ForecastAccount {
  return { id, label: id, left, resetsAt: resetsInHours === null ? null : NOW + resetsInHours * HOUR_MS };
}

function weekly(usedPercent: number, resetsAt: number | null): AccountUsage {
  return {
    status: 'ok',
    windows: [
      {
        id: 'session',
        kind: 'session',
        label: 'Session',
        model: null,
        usedPercent: 99,
        resetsAt: NOW + HOUR_MS,
      },
      { id: 'weekly', kind: 'weekly', label: 'Weekly', model: null, usedPercent, resetsAt },
    ],
    detail: null,
    checkedAt: NOW,
    source: 'read',
  };
}

function summary(overrides: Partial<AccountSummary>): AccountSummary {
  return {
    id: 'work',
    email: 'work@example.com',
    organization: null,
    plan: 'max',
    origin: 'login',
    isDefault: false,
    paused: false,
    switchAt: null,
    signIn: 'signed_in',
    signInDetail: null,
    usage: weekly(60, NOW + 10 * HOUR_MS),
    spentUntil: null,
    runs: 0,
    ...overrides,
  };
}

describe('resolveUsageForecast', () => {
  test('has nothing to forecast without an account', () => {
    expect(resolveUsageForecast([], NOW)).toBeNull();
  });

  test('keeps the pace that lasts until the account resets', () => {
    const forecast = resolveUsageForecast([account('solo', 10, 24)], NOW);
    expect(forecast?.safePace).toBe(10);
    expect(forecast?.tightest).toEqual({
      accountId: 'solo',
      at: NOW + 24 * HOUR_MS,
      leftBefore: expect.any(Number),
    });
    expect(forecast?.tightest?.leftBefore).toBeLessThan(0.1);
    expect(forecast?.from).toBe(NOW);
    expect(forecast?.to).toBe(NOW + FORECAST_LIMITS.horizonMs);
    expect(forecast?.segments).toEqual([
      { accountId: 'solo', from: NOW, to: NOW + 24 * HOUR_MS, left: 10, emptyAt: null },
      {
        accountId: 'solo',
        from: NOW + 24 * HOUR_MS,
        to: NOW + FORECAST_LIMITS.horizonMs,
        left: 100,
        emptyAt: null,
      },
    ]);
    expect(forecast?.outages).toEqual([]);
    expect(forecast?.timelinePace).toBe(10);
  });

  test('draws when each account runs out at the pace and where every account is out at once', () => {
    const forecast = resolveUsageForecast([account('near', 10, 24), account('far', 20, 72)], NOW, 60);
    expect(forecast?.safePace).toBe(30);
    expect(forecast?.timelinePace).toBe(60);
    expect(forecast?.segments.map((segment) => [segment.accountId, segment.from, segment.emptyAt])).toEqual([
      ['near', NOW, NOW + 4 * HOUR_MS],
      ['near', NOW + 24 * HOUR_MS, NOW + 64 * HOUR_MS],
      ['far', NOW, NOW + 12 * HOUR_MS],
      ['far', NOW + 72 * HOUR_MS, NOW + 112 * HOUR_MS],
    ]);
    expect(forecast?.outages).toEqual([
      { from: NOW + 12 * HOUR_MS, to: NOW + 24 * HOUR_MS },
      { from: NOW + 64 * HOUR_MS, to: NOW + 72 * HOUR_MS },
      { from: NOW + 112 * HOUR_MS, to: NOW + FORECAST_LIMITS.horizonMs },
    ]);
    expect(forecast?.runsOutAt).toBe(NOW + 12 * HOUR_MS);
  });

  test('keeps the timeline at the safe pace when the last 24 hours were slower', () => {
    const forecast = resolveUsageForecast([account('solo', 10, 24)], NOW, 5);
    expect(forecast?.timelinePace).toBe(forecast?.safePace);
  });

  test('shows every account out until the first reset when the pool is spent', () => {
    const forecast = resolveUsageForecast([account('spent', 0, 2), account('later', 0, 30)], NOW);
    expect(forecast?.safePace).toBe(0);
    expect(forecast?.outages).toEqual([{ from: NOW, to: NOW + 2 * HOUR_MS }]);
    expect(forecast?.segments[0]?.emptyAt).toBe(NOW);
  });

  test('spends the account that resets soonest first, so a late reset sets the pace', () => {
    const forecast = resolveUsageForecast(
      [account('far', 20, 165), account('near', 0, 15), account('later', 20, 160), account('next', 0, 63)],
      NOW
    );
    expect(forecast?.accounts.map((entry) => entry.id)).toEqual(['near', 'next', 'later', 'far']);
    expect(forecast?.safePace).toBe(36);
    expect(forecast?.tightest?.accountId).toBe('later');
    expect(forecast?.resets.map((reset) => reset.accountId)).toEqual(['near', 'next', 'later', 'far']);
  });

  test('rounds the pace down so it stays safe', () => {
    expect(resolveUsageForecast([account('solo', 9.96, 24)], NOW)?.safePace).toBe(9.9);
    expect(resolveUsageForecast([account('solo', 9.94, 24)], NOW)?.safePace).toBe(9.9);
  });

  test('says when the pool runs out at the current pace', () => {
    const forecast = resolveUsageForecast([account('solo', 10, 24)], NOW, 20);
    expect(forecast?.currentPace).toBe(20);
    expect(forecast?.runsOutAt).toBe(NOW + 12 * HOUR_MS);
    expect(resolveUsageForecast([account('solo', 10, 24)], NOW, 5)?.runsOutAt).toBeNull();
    expect(resolveUsageForecast([account('solo', 10, 24)], NOW, 0)?.runsOutAt).toBeNull();
    expect(resolveUsageForecast([account('solo', 10, 24)], NOW)?.runsOutAt).toBeNull();
  });

  test('spreads an account with no known reset over the whole week', () => {
    const forecast = resolveUsageForecast([account('open', 70, null)], NOW);
    expect(forecast?.safePace).toBe(10);
    expect(forecast?.resets).toEqual([]);
    expect(forecast?.tightest).toBeNull();
    expect(forecast?.segments).toEqual([
      { accountId: 'open', from: NOW, to: NOW + FORECAST_LIMITS.horizonMs, left: 70, emptyAt: null },
    ]);
  });

  test('a spent pool has no safe pace until a reset', () => {
    const forecast = resolveUsageForecast([account('spent', 0, 1)], NOW, 10);
    expect(forecast?.safePace).toBe(0);
    expect(forecast?.runsOutAt).toBe(NOW);
  });
});

describe('resolveForecastAccount', () => {
  test('reads what the weekly window has left', () => {
    expect(resolveForecastAccount('work', 'Work', weekly(60, NOW + HOUR_MS), null, NOW)).toEqual({
      id: 'work',
      label: 'Work',
      left: 40,
      resetsAt: NOW + HOUR_MS,
    });
  });

  test('has nothing left while the account is spent until its weekly reset', () => {
    const resetsAt = NOW + HOUR_MS;
    expect(resolveForecastAccount('work', 'Work', weekly(60, resetsAt), resetsAt, NOW)?.left).toBe(0);
    expect(resolveForecastAccount('work', 'Work', weekly(60, null), NOW + 1, NOW)?.left).toBe(0);
    expect(resolveForecastAccount('work', 'Work', weekly(60, resetsAt), NOW, NOW)?.left).toBe(40);
  });

  test('keeps the weekly budget of an account spent only until a shorter limit resets', () => {
    expect(resolveForecastAccount('work', 'Work', weekly(60, NOW + 2 * HOUR_MS), NOW + 1, NOW)?.left).toBe(
      40
    );
  });

  test('a reading from before its reset counts a full week', () => {
    expect(resolveForecastAccount('work', 'Work', weekly(100, NOW - HOUR_MS), null, NOW)).toEqual({
      id: 'work',
      label: 'Work',
      left: 100,
      resetsAt: NOW - HOUR_MS + FORECAST_LIMITS.weekMs,
    });
  });

  test('never counts more than nothing left', () => {
    expect(resolveForecastAccount('work', 'Work', weekly(120, null), null, NOW)?.left).toBe(0);
  });

  test('skips an account without a weekly window', () => {
    const usage = { ...weekly(10, null), windows: [] };
    expect(resolveForecastAccount('work', 'Work', usage, null, NOW)).toBeNull();
  });
});

describe('listForecastAccounts', () => {
  test('counts only accounts agents can use', () => {
    const accounts = listForecastAccounts(
      [
        summary({ id: 'work' }),
        summary({ id: 'nameless', email: null }),
        summary({ id: 'paused', paused: true }),
        summary({ id: 'out', signIn: 'signed_out' }),
        summary({ id: 'blank', usage: { ...weekly(0, null), windows: [] } }),
      ],
      NOW
    );
    expect(accounts.map((entry) => [entry.id, entry.label])).toEqual([
      ['work', 'work@example.com'],
      ['nameless', 'nameless'],
    ]);
  });
});
