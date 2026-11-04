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
      { accountId: 'solo', from: NOW, to: NOW + 24 * HOUR_MS, left: 10 },
      { accountId: 'solo', from: NOW + 24 * HOUR_MS, to: NOW + FORECAST_LIMITS.horizonMs, left: 100 },
    ]);
    expect(forecast?.points.map((point) => point.at)).toEqual([
      NOW,
      NOW + 24 * HOUR_MS,
      NOW + 24 * HOUR_MS,
      NOW + FORECAST_LIMITS.horizonMs,
    ]);
    expect(forecast?.points[2]?.left).toBeCloseTo(100, 0);
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
      { accountId: 'open', from: NOW, to: NOW + FORECAST_LIMITS.horizonMs, left: 70 },
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
