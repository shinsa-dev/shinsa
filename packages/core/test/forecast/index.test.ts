import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  type AccountSummary,
  type AccountUsage,
  type ForecastAccount,
  FORECAST_LIMITS,
  HOUR_MS,
  type AccountsSnapshot,
  listForecastAccounts,
  listForecastProviders,
  listProviderForecastAccounts,
  listProviderPaces,
  resolveCandidateSpentUntil,
  resolveGrantRefill,
  STALE_USAGE_MS,
  type UsageResetGrant,
  resolveForecastAccount,
  resolveForecastTimeline,
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
    expect(Option.getOrNull(resolveUsageForecast([], NOW))).toBeNull();
  });

  test('keeps the pace that lasts until the account resets', () => {
    const forecast = Option.getOrNull(resolveUsageForecast([account('solo', 10, 24)], NOW));
    expect(forecast?.safePace).toBe(10);
    expect(forecast?.tightest).toEqual({
      accountId: 'solo',
      at: NOW + 24 * HOUR_MS,
      leftBefore: expect.any(Number),
    });
    expect(forecast?.tightest?.leftBefore).toBeLessThan(0.1);
    expect(forecast?.from).toBe(NOW);
    expect(forecast?.to).toBe(NOW + FORECAST_LIMITS.horizonMs);
    if (!forecast) throw new Error('no forecast');
    const timeline = resolveForecastTimeline(forecast, forecast.safePace);
    expect(timeline.segments).toEqual([
      { accountId: 'solo', from: NOW, to: NOW + 24 * HOUR_MS, left: 10, emptyAt: null },
      {
        accountId: 'solo',
        from: NOW + 24 * HOUR_MS,
        to: NOW + FORECAST_LIMITS.horizonMs,
        left: 100,
        emptyAt: null,
      },
    ]);
    expect(timeline.outages).toEqual([]);
  });

  test('draws when each account runs out at the pace and where every account is out at once', () => {
    const forecast = Option.getOrNull(
      resolveUsageForecast([account('near', 10, 24), account('far', 20, 72)], NOW, 60)
    );
    expect(forecast?.safePace).toBe(30);
    if (!forecast) throw new Error('no forecast');
    const timeline = resolveForecastTimeline(forecast, 60);
    expect(timeline.segments.map((segment) => [segment.accountId, segment.from, segment.emptyAt])).toEqual([
      ['near', NOW, NOW + 4 * HOUR_MS],
      ['near', NOW + 24 * HOUR_MS, NOW + 64 * HOUR_MS],
      ['far', NOW, NOW + 12 * HOUR_MS],
      ['far', NOW + 72 * HOUR_MS, NOW + 112 * HOUR_MS],
    ]);
    expect(timeline.outages).toEqual([
      { from: NOW + 12 * HOUR_MS, to: NOW + 24 * HOUR_MS },
      { from: NOW + 64 * HOUR_MS, to: NOW + 72 * HOUR_MS },
      { from: NOW + 112 * HOUR_MS, to: NOW + FORECAST_LIMITS.horizonMs },
    ]);
    expect(forecast?.runsOutAt).toBe(NOW + 12 * HOUR_MS);
  });

  test('shows every account out until the first reset when the pool is spent', () => {
    const forecast = Option.getOrNull(
      resolveUsageForecast([account('spent', 0, 2), account('later', 0, 30)], NOW)
    );
    expect(forecast?.safePace).toBe(0);
    if (!forecast) throw new Error('no forecast');
    const timeline = resolveForecastTimeline(forecast, forecast.safePace);
    expect(timeline.outages).toEqual([{ from: NOW, to: NOW + 2 * HOUR_MS }]);
    expect(timeline.segments[0]?.emptyAt).toBe(NOW);
  });

  test('spends the account that resets soonest first, so a late reset sets the pace', () => {
    const forecast = Option.getOrNull(
      resolveUsageForecast(
        [account('far', 20, 165), account('near', 0, 15), account('later', 20, 160), account('next', 0, 63)],
        NOW
      )
    );
    expect(forecast?.accounts.map((entry) => entry.id)).toEqual(['near', 'next', 'later', 'far']);
    expect(forecast?.safePace).toBe(36);
    expect(forecast?.tightest?.accountId).toBe('later');
    expect(forecast?.resets.map((reset) => reset.accountId)).toEqual(['near', 'next', 'later', 'far']);
  });

  test('rounds the pace down so it stays safe', () => {
    expect(Option.getOrNull(resolveUsageForecast([account('solo', 9.96, 24)], NOW))?.safePace).toBe(9.9);
    expect(Option.getOrNull(resolveUsageForecast([account('solo', 9.94, 24)], NOW))?.safePace).toBe(9.9);
  });

  test('says when the pool runs out at the current pace', () => {
    const forecast = Option.getOrNull(resolveUsageForecast([account('solo', 10, 24)], NOW, 20));
    expect(forecast?.currentPace).toBe(20);
    expect(forecast?.runsOutAt).toBe(NOW + 12 * HOUR_MS);
    expect(Option.getOrNull(resolveUsageForecast([account('solo', 10, 24)], NOW, 5))?.runsOutAt).toBeNull();
    expect(Option.getOrNull(resolveUsageForecast([account('solo', 10, 24)], NOW, 0))?.runsOutAt).toBeNull();
    expect(Option.getOrNull(resolveUsageForecast([account('solo', 10, 24)], NOW))?.runsOutAt).toBeNull();
  });

  test('spreads an account with no known reset over the whole week', () => {
    const forecast = Option.getOrNull(resolveUsageForecast([account('open', 70, null)], NOW));
    expect(forecast?.safePace).toBe(10);
    expect(forecast?.resets).toEqual([]);
    expect(forecast?.tightest).toBeNull();
    if (!forecast) throw new Error('no forecast');
    expect(resolveForecastTimeline(forecast, forecast.safePace).segments).toEqual([
      { accountId: 'open', from: NOW, to: NOW + FORECAST_LIMITS.horizonMs, left: 70, emptyAt: null },
    ]);
  });

  test('a spent pool has no safe pace until a reset', () => {
    const forecast = Option.getOrNull(resolveUsageForecast([account('spent', 0, 1)], NOW, 10));
    expect(forecast?.safePace).toBe(0);
    expect(forecast?.runsOutAt).toBe(NOW);
  });
});

describe('resolveForecastTimeline', () => {
  test('runs the week again at a pace you try, and marks where every account is out of usage', () => {
    const forecast = Option.getOrNull(
      resolveUsageForecast([account('work', 10, 24), account('home', 20, 72)], NOW)
    );
    if (!forecast) throw new Error('no forecast');
    const safe = resolveForecastTimeline(forecast, forecast.safePace);
    expect(safe.outages).toEqual([]);
    const faster = resolveForecastTimeline(forecast, forecast.safePace * 2);
    expect(faster.pace).toBe(forecast.safePace * 2);
    expect(faster.outages.length).toBeGreaterThan(0);
    expect(faster.segments.map((segment) => segment.accountId)[0]).toBe('work');
  });
});

describe('resolveForecastAccount', () => {
  test('reads what the weekly window has left', () => {
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(60, NOW + HOUR_MS), null, NOW))
    ).toEqual({
      id: 'work',
      label: 'Work',
      left: 40,
      resetsAt: NOW + HOUR_MS,
    });
  });

  test('has nothing left while the account is spent until its weekly reset', () => {
    const resetsAt = NOW + HOUR_MS;
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(60, resetsAt), resetsAt, NOW))?.left
    ).toBe(0);
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(60, null), NOW + 1, NOW))?.left
    ).toBe(0);
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(60, resetsAt), NOW, NOW))?.left
    ).toBe(40);
  });

  test('keeps the weekly budget of an account spent only until a shorter limit resets', () => {
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(60, NOW + 2 * HOUR_MS), NOW + 1, NOW))
        ?.left
    ).toBe(40);
  });

  test('a reading from before its reset counts a full week', () => {
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(100, NOW - HOUR_MS), null, NOW))
    ).toEqual({
      id: 'work',
      label: 'Work',
      left: 100,
      resetsAt: NOW - HOUR_MS + FORECAST_LIMITS.weekMs,
    });
  });

  test('never counts more than nothing left', () => {
    expect(Option.getOrNull(resolveForecastAccount('work', 'Work', weekly(120, null), null, NOW))?.left).toBe(
      0
    );
  });

  test('skips an account without a weekly window', () => {
    const usage = { ...weekly(10, null), windows: [] };
    expect(Option.getOrNull(resolveForecastAccount('work', 'Work', usage, null, NOW))).toBeNull();
  });
});

describe('the forecast for one model', () => {
  function withFable(usedPercent: number, resetsAt: number | null): AccountUsage {
    const reading = weekly(40, NOW + 50 * HOUR_MS);
    return {
      ...reading,
      windows: [
        ...reading.windows,
        { id: 'weekly:fable', kind: 'model', label: 'Fable', model: 'Fable', usedPercent, resetsAt },
      ],
    };
  }

  test('counts the model’s own weekly window when it leaves less than the all-models one', () => {
    const usage = withFable(90, NOW + 20 * HOUR_MS);
    const forecast = (model: string | null) =>
      Option.getOrNull(resolveForecastAccount('work', 'Work', usage, null, NOW, { model }));
    expect(forecast('claude-fable-5-2')).toMatchObject({ left: 10, resetsAt: NOW + 20 * HOUR_MS });
    expect(forecast('opus')).toMatchObject({ left: 60, resetsAt: NOW + 50 * HOUR_MS });
    expect(forecast(null)).toMatchObject({ left: 60 });
  });

  test('keeps the all-models window when the model’s own one leaves more', () => {
    const usage = withFable(10, NOW + 20 * HOUR_MS);
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'Work', usage, null, NOW, { model: 'fable' }))
    ).toMatchObject({ left: 60, resetsAt: NOW + 50 * HOUR_MS });
  });

  test('a mark for one model empties the account only for that model', () => {
    const spent = summary({ spentUntil: NOW + 20 * HOUR_MS, spentModel: 'fable' });
    const left = (model: string | null) =>
      listForecastAccounts([spent], NOW, { model }).map((entry) => entry.left);
    expect(left('fable')).toEqual([0]);
    expect(left('opus')).toEqual([40]);
    expect(left(null)).toEqual([0]);
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

  test('an account spent only by a stale reading keeps its weekly budget', () => {
    const resetsAt = NOW + 100 * HOUR_MS;
    const reading = weekly(56, resetsAt);
    const usage: AccountUsage = {
      ...reading,
      windows: [
        ...reading.windows,
        { id: 'weekly:fable', kind: 'model', label: 'Fable', model: 'Fable', usedPercent: 100, resetsAt },
      ],
    };
    const left = (now: number) =>
      listForecastAccounts(
        [
          summary({
            usage,
            spentUntil: Option.getOrNull(
              resolveCandidateSpentUntil({ spentUntil: null, usage }, 'fable', now)
            ),
          }),
        ],
        now
      ).map((entry) => entry.left);
    expect(left(NOW + STALE_USAGE_MS)).toEqual([0]);
    expect(left(NOW + STALE_USAGE_MS + 1)).toEqual([44]);
  });
});

function grant(overrides: Partial<UsageResetGrant>): UsageResetGrant {
  return {
    id: 'launch',
    label: null,
    left: 1,
    total: 1,
    clears: ['five_hour', 'seven_day'],
    usableNow: true,
    endsAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<AccountsSnapshot>): AccountsSnapshot {
  return { accounts: [], login: null, imports: [], ...overrides };
}

describe('resolveGrantRefill', () => {
  test('counts each usable reset that clears the weekly limit as a full refill', () => {
    const usage = {
      ...weekly(60, null),
      resetGrants: [
        grant({ left: 2 }),
        grant({ id: 'session', clears: ['five_hour'] }),
        grant({ id: 'later', usableNow: false }),
        grant({ id: 'ended', endsAt: NOW - HOUR_MS }),
        grant({ id: 'open', endsAt: NOW + HOUR_MS }),
        grant({ id: 'spent', left: -1 }),
      ],
    };
    expect(resolveGrantRefill(usage, NOW)).toBe(3 * FORECAST_LIMITS.fullPercent);
    expect(resolveGrantRefill(weekly(60, null), NOW)).toBe(0);
  });

  test('adds the refill to an account only when the forecast asks for grants', () => {
    const usage = { ...weekly(60, NOW + 10 * HOUR_MS), resetGrants: [grant({})] };
    expect(Option.getOrNull(resolveForecastAccount('work', 'work', usage, null, NOW))?.left).toBe(40);
    expect(
      Option.getOrNull(resolveForecastAccount('work', 'work', usage, null, NOW, { grants: true }))?.left
    ).toBe(140);
  });
});

describe('the forecast of each provider in a snapshot', () => {
  const codex = {
    provider: 'codex',
    label: 'Codex',
    status: 'signed_in' as const,
    method: null,
    version: null,
    detail: null,
    fix: null,
    email: 'me@example.com',
    usage: weekly(20, NOW + 10 * HOUR_MS),
  };

  test('lists Claude first, then every other provider signed in', () => {
    expect(listForecastProviders(snapshot({ providers: [{ ...codex, provider: 'claude' }, codex] }))).toEqual(
      ['claude', 'codex']
    );
  });

  test('reads Claude from its accounts, and another provider from its own sign-in', () => {
    const both = snapshot({ accounts: [summary({})], providers: [codex] });
    expect(listProviderForecastAccounts(both, 'claude', NOW).map((entry) => entry.id)).toEqual(['work']);
    expect(listProviderForecastAccounts(both, 'codex', NOW)).toEqual([
      { id: 'codex', label: 'me@example.com', left: 80, resetsAt: NOW + 10 * HOUR_MS },
    ]);
    expect(listProviderForecastAccounts(both, 'gemini', NOW)).toEqual([]);
    const signedOut = snapshot({ providers: [{ ...codex, status: 'signed_out', email: null }] });
    expect(listProviderForecastAccounts(signedOut, 'codex', NOW)).toEqual([]);
    const unread = snapshot({ providers: [{ ...codex, usage: undefined }] });
    expect(listProviderForecastAccounts(unread, 'codex', NOW)).toEqual([]);
    const unlabelled = snapshot({
      providers: [{ ...codex, email: null, usage: { ...codex.usage, windows: [] } }],
    });
    expect(listProviderForecastAccounts(unlabelled, 'codex', NOW)).toEqual([]);
  });

  test('gives each provider its safe pace with usable resets counted, or none with nothing to forecast', () => {
    const out = weekly(100, NOW + 144 * HOUR_MS);
    const [claude] = listProviderPaces(
      snapshot({ accounts: [summary({ usage: { ...out, resetGrants: [grant({})] } })] }),
      NOW
    );
    const [plain] = listProviderPaces(snapshot({ accounts: [summary({ usage: out })] }), NOW);
    expect(plain?.pace).toBe(0);
    expect(claude?.pace ?? 0).toBeGreaterThan(10);
    expect(listProviderPaces(snapshot({}), NOW)).toEqual([{ provider: 'claude', pace: null }]);
  });
});
