import { afterEach, describe, expect, test } from 'bun:test';
import { UsageReadings } from '../../src/accounts/readings/service.ts';
import { AccountStore } from '../../src/accounts/store/service.ts';
import {
  parseExtraUsage,
  parseResetGrants,
  parseResetTime,
  parseUsageWindows,
  readRetryAfter,
  resolveClaudeFastMode,
  type UsageRequester,
} from '../../src/accounts/usage.ts';
import { type AccountsHarness, buildUnitAccounts } from './harness.ts';

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function requestUsage(accessToken: string, requestHttp: UsageRequester) {
  const harness = await buildUnitAccounts({
    requestHttp,
    readSecret: () => Promise.resolve(JSON.stringify({ claudeAiOauth: { accessToken } })),
  });
  open.push(harness);
  const account = await harness.run(harness.service(AccountStore).create());
  return harness.run(harness.service(UsageReadings).readAccount(account.id));
}

const SESSION_RESET = '2026-10-23T00:20:00.302718+00:00';
const WEEKLY_RESET = '2026-10-28T09:00:00+00:00';

const BODY = {
  five_hour: { utilization: 82, resets_at: SESSION_RESET },
  seven_day: { utilization: 30, resets_at: WEEKLY_RESET },
  seven_day_opus: null,
  nimbus_quill: null,
  limits: [
    { kind: 'session', group: 'session', percent: 82, resets_at: SESSION_RESET, scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 30, resets_at: WEEKLY_RESET, scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 8,
      resets_at: WEEKLY_RESET,
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
  ],
  extra_usage: { is_enabled: false },
  spend: { amount: 0 },
};

function respondWith(response: Response | (() => Promise<Response>)) {
  const calls: [string, RequestInit][] = [];
  const requestHttp: UsageRequester = (url, init) => {
    calls.push([url, init]);
    return typeof response === 'function' ? response() : Promise.resolve(response);
  };
  return { requestHttp, calls };
}

describe('usage windows', () => {
  test('reads the session, the weekly and each model-scoped weekly window from limits', () => {
    expect(parseUsageWindows(BODY)).toEqual([
      {
        id: 'five_hour',
        kind: 'session',
        label: '5-hour limit',
        model: null,
        usedPercent: 82,
        resetsAt: Date.parse(SESSION_RESET),
      },
      {
        id: 'seven_day',
        kind: 'weekly',
        label: 'Weekly · All models',
        model: null,
        usedPercent: 30,
        resetsAt: Date.parse(WEEKLY_RESET),
      },
      {
        id: 'weekly:fable',
        kind: 'model',
        label: 'Weekly · Fable',
        model: 'Fable',
        usedPercent: 8,
        resetsAt: Date.parse(WEEKLY_RESET),
      },
    ]);
  });

  test('without limits the keyed windows are read, and empty or broken ones are skipped', () => {
    const windows = parseUsageWindows({
      five_hour: { utilization: 140, resets_at: 'not a date' },
      seven_day: { utilization: 'high' },
      seven_day_sonnet: { utilization: -5, resets_at: null },
      seven_day_opus: null,
    });
    expect(windows).toEqual([
      {
        id: 'five_hour',
        kind: 'session',
        label: '5-hour limit',
        model: null,
        usedPercent: 100,
        resetsAt: null,
      },
      {
        id: 'weekly:sonnet',
        kind: 'model',
        label: 'Weekly · Sonnet',
        model: 'Sonnet',
        usedPercent: 0,
        resetsAt: null,
      },
    ]);
  });

  test('a model window has one id whichever field reports it, and the limits list wins', () => {
    const windows = parseUsageWindows({
      seven_day_opus: { utilization: 90, resets_at: WEEKLY_RESET },
      seven_day_sonnet: { utilization: 20, resets_at: WEEKLY_RESET },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 40,
          resets_at: WEEKLY_RESET,
          scope: { model: { display_name: 'Opus' } },
        },
        {
          kind: 'weekly_scoped',
          percent: 70,
          resets_at: WEEKLY_RESET,
          scope: { model: { display_name: 'opus' } },
        },
      ],
    });
    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['weekly:opus', 40],
      ['weekly:sonnet', 20],
    ]);
  });

  test('limits without a percent, a kind or a model are skipped, and a model name becomes a stable id', () => {
    const windows = parseUsageWindows({
      limits: [
        'junk',
        { kind: 'session', percent: Number.NaN },
        { percent: 10 },
        { kind: 'weekly_scoped', percent: 10, scope: { model: null } },
        { kind: 'weekly_scoped', percent: 10, scope: 'all' },
        { kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: 'Opus 4.1' } } },
      ],
      five_hour: { utilization: 5 },
    });
    expect(windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
      ['weekly:opus_4_1', 'Weekly · Opus 4.1', 12],
      ['five_hour', '5-hour limit', 5],
    ]);
  });

  test('a body that is not an object has no windows', () => {
    expect(parseUsageWindows(null)).toEqual([]);
    expect(parseUsageWindows([BODY])).toEqual([]);
  });

  test('reset times are ISO strings; anything else is unknown', () => {
    expect(parseResetTime(SESSION_RESET)).toBe(Date.parse(SESSION_RESET));
    expect(parseResetTime('soon')).toBeNull();
    expect(parseResetTime(1_700_000_000)).toBeNull();
  });
});

describe('resolveClaudeFastMode', () => {
  test('fast mode runs only on usage credits the account already has turned on', () => {
    expect(
      resolveClaudeFastMode({ extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 0 } })
    ).toBe('available');
    expect(
      resolveClaudeFastMode({ extra_usage: { is_enabled: true, monthly_limit: 20, used_credits: 19.5 } })
    ).toBe('available');
    expect(resolveClaudeFastMode({ extra_usage: { is_enabled: true } })).toBe('available');
  });

  test('a subscription without usage credits, or with them spent, needs credits', () => {
    expect(resolveClaudeFastMode({ extra_usage: null })).toBe('needs_credits');
    expect(resolveClaudeFastMode({ extra_usage: { is_enabled: false, monthly_limit: 50 } })).toBe(
      'needs_credits'
    );
    expect(
      resolveClaudeFastMode({ extra_usage: { is_enabled: true, monthly_limit: 20, used_credits: 20 } })
    ).toBe('needs_credits');
  });

  test('an answer that says nothing about usage credits leaves it unknown', () => {
    expect(resolveClaudeFastMode({ five_hour: null })).toBe('unknown');
    expect(resolveClaudeFastMode('nope')).toBe('unknown');
  });
});

const WEEKLY_GRANT = {
  id: 'full-reset-2611',
  label: 'One full limit reset (November 2026)',
  resets_total: 1,
  resets_left: 1,
  starts_at: '2026-11-10T21:30:00+00:00',
  ends_at: '2026-12-10T22:00:00+00:00',
  clears: ['seven_day', 'seven_day_overage_included', 3],
  paused: false,
  usable_now: true,
  use_requires_limit: false,
  percent_used: { seven_day: 8, seven_day_overage_included: 2 },
  blocking: [],
  arm: null,
  type: 'weekly',
  unavailable_reason: null,
  gives_back_weekly: false,
};

const FABLE_GRANT = {
  ...WEEKLY_GRANT,
  id: 'launch-2610-fable-6mo',
  label: "New model launch: one more Fable reset at 6 months' tenure",
  starts_at: '2026-11-09T18:00:00+00:00',
  ends_at: '2027-03-09T07:59:00+00:00',
  clears: ['seven_day_overage_included'],
  type: 'full',
  gives_back_weekly: true,
};

const SPENT_FABLE_GRANT = {
  ...FABLE_GRANT,
  id: 'launch-2610-fable',
  resets_left: 0,
  usable_now: false,
  unavailable_reason: 'unavailable',
};

const SCOPED_SHARES = [{ limit_index: 1, used_percent_of_weekly: 12, allowance_percent_of_weekly: 50 }];

const RESET_STATUS = {
  eligible: true,
  ineligible_reason: null,
  at_limit: false,
  exhausted: [],
  grants: [WEEKLY_GRANT, SPENT_FABLE_GRANT, FABLE_GRANT],
  next_grant_id: 'full-reset-2611',
  weekly_resets_at: '2026-11-16T05:00:00+00:00',
  cooldown_until: null,
};

describe('parseExtraUsage', () => {
  test('extra usage off with nothing left reads as off without credit', () => {
    expect(
      parseExtraUsage({
        extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, currency: null },
        spend: { enabled: false, balance: null },
      })
    ).toEqual({ enabled: false, noLimit: false, credit: null });
  });

  test('a spend balance is the credit, whether or not extra usage is on', () => {
    const balance = { amount_minor: 1240, currency: 'EUR', exponent: 2 };
    expect(parseExtraUsage({ extra_usage: { is_enabled: false }, spend: { balance } })).toEqual({
      enabled: false,
      noLimit: false,
      credit: { minor: 1240, exponent: 2, currency: 'EUR' },
    });
    expect(parseExtraUsage({ spend: { enabled: true, balance } })?.credit).toEqual({
      minor: 1240,
      exponent: 2,
      currency: 'EUR',
    });
  });

  test('without a balance, the monthly limit less what was used is the credit while extra usage is on', () => {
    expect(
      parseExtraUsage({
        extra_usage: {
          is_enabled: true,
          monthly_limit: 5000,
          used_credits: 1260,
          currency: 'USD',
          decimal_places: 2,
        },
      })
    ).toEqual({ enabled: true, noLimit: false, credit: { minor: 3740, exponent: 2, currency: 'USD' } });
    expect(
      parseExtraUsage({ extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 6000 } })?.credit
    ).toEqual({ minor: 0, exponent: 2, currency: 'USD' });
    expect(parseExtraUsage({ extra_usage: { is_enabled: false, monthly_limit: 5000 } })?.credit).toBeNull();
  });

  test('an empty balance falls back to the monthly limit, and alone is not "no limit"', () => {
    const empty = { amount_minor: 0, currency: 'USD', exponent: 2 };
    expect(
      parseExtraUsage({
        extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1000 },
        spend: { balance: empty },
      })?.credit
    ).toEqual({ minor: 4000, exponent: 2, currency: 'USD' });
    expect(parseExtraUsage({ extra_usage: { is_enabled: true }, spend: { balance: empty } })).toEqual({
      enabled: true,
      noLimit: false,
      credit: null,
    });
  });

  test('extra usage on without a monthly limit or a balance has no limit', () => {
    expect(parseExtraUsage({ extra_usage: { is_enabled: true, monthly_limit: null } })).toEqual({
      enabled: true,
      noLimit: true,
      credit: null,
    });
  });

  test('spend decides when extra usage is missing, and a malformed field drops only itself', () => {
    expect(parseExtraUsage({ spend: { enabled: true } })).toEqual({
      enabled: true,
      noLimit: true,
      credit: null,
    });
    expect(
      parseExtraUsage({
        extra_usage: { is_enabled: true, monthly_limit: 'lots', decimal_places: 40, currency: 7 },
        spend: { balance: { amount_minor: 'x', currency: 'USD', exponent: 2 } },
      })
    ).toEqual({ enabled: true, noLimit: true, credit: null });
    expect(
      parseExtraUsage({ spend: { balance: { amount_minor: -50, currency: 'USD', exponent: 2 } } })
    ).toEqual({
      enabled: false,
      noLimit: false,
      credit: null,
    });
  });

  test('an answer without extra usage or spend says nothing', () => {
    expect(parseExtraUsage({ five_hour: null })).toBeNull();
    expect(parseExtraUsage({ extra_usage: null, spend: 'none' })).toBeNull();
    expect(parseExtraUsage('nope')).toBeNull();
  });
});

describe('parseResetGrants', () => {
  test('reads the weekly and the Fable reset under cedar_ember and drops the spent one', () => {
    expect(parseResetGrants({ cedar_ember: RESET_STATUS, weekly_scoped_shares: SCOPED_SHARES })).toEqual([
      {
        id: 'full-reset-2611',
        label: 'One full limit reset (November 2026)',
        left: 1,
        total: 1,
        clears: ['seven_day', 'seven_day_overage_included'],
        usableNow: true,
        endsAt: Date.parse('2026-12-10T22:00:00+00:00'),
        givesBackWeekly: false,
        weeklyShare: null,
      },
      {
        id: 'launch-2610-fable-6mo',
        label: "New model launch: one more Fable reset at 6 months' tenure",
        left: 1,
        total: 1,
        clears: ['seven_day_overage_included'],
        usableNow: true,
        endsAt: Date.parse('2027-03-09T07:59:00+00:00'),
        givesBackWeekly: true,
        weeklyShare: 12,
      },
    ]);
  });

  test('an account Claude finds ineligible has no grants', () => {
    expect(
      parseResetGrants({
        cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [], next_grant_id: null },
      })
    ).toEqual([]);
  });

  test('a grant with only the required fields reads with defaults', () => {
    expect(parseResetGrants({ cedar_ember: { grants: [{ id: 'bare', resets_left: 1 }] } })).toEqual([
      {
        id: 'bare',
        label: null,
        left: 1,
        total: 1,
        clears: [],
        usableNow: false,
        endsAt: null,
        givesBackWeekly: false,
        weeklyShare: null,
      },
    ]);
  });

  test('a Fable reset gives back the sum of the scoped shares of the weekly limit', () => {
    const fable = (shares: unknown) =>
      parseResetGrants({ cedar_ember: { grants: [FABLE_GRANT] }, weekly_scoped_shares: shares })[0];
    expect(
      fable([{ limit_index: 1, used_percent_of_weekly: 4 }, { used_percent_of_weekly: 3 }])
    ).toMatchObject({
      givesBackWeekly: true,
      weeklyShare: 7,
    });
    expect(fable([{ limit_index: 1 }, 'share'])?.weeklyShare).toBeNull();
    expect(fable(undefined)?.weeklyShare).toBeNull();
  });

  test('a reset that gives nothing back keeps no share, whatever the answer holds', () => {
    expect(
      parseResetGrants({ cedar_ember: { grants: [WEEKLY_GRANT] }, weekly_scoped_shares: SCOPED_SHARES })[0]
    ).toMatchObject({ givesBackWeekly: false, weeklyShare: null });
  });

  test('a paused grant is not usable now, whatever usable_now says', () => {
    expect(
      parseResetGrants({ cedar_ember: { grants: [{ ...WEEKLY_GRANT, paused: true }] } })[0]?.usableNow
    ).toBe(false);
  });

  test('spent, id-less, repeated and malformed grants are dropped', () => {
    expect(
      parseResetGrants({
        cedar_ember: {
          grants: [
            { ...WEEKLY_GRANT, resets_left: 0 },
            { ...WEEKLY_GRANT, id: '' },
            { ...WEEKLY_GRANT, id: undefined },
            { ...WEEKLY_GRANT, resets_left: 'one' },
            'grant',
            WEEKLY_GRANT,
            WEEKLY_GRANT,
          ],
        },
      }).map((grant) => grant.id)
    ).toEqual(['full-reset-2611']);
  });

  test('grants under any other program are not read', () => {
    expect(parseResetGrants({ cedar_ember: null, juniper_tide: { grants: [WEEKLY_GRANT] } })).toEqual([]);
  });

  test('no program, an empty program and a body that is not an object have no grants', () => {
    expect(parseResetGrants({ cedar_ember: null })).toEqual([]);
    expect(parseResetGrants({ cedar_ember: { grants: 'none' } })).toEqual([]);
    expect(parseResetGrants({ cedar_ember: {} })).toEqual([]);
    expect(parseResetGrants(null)).toEqual([]);
  });
});

describe('reading an account’s usage from Claude', () => {
  test('asks the usage endpoint with the account’s token and reads the windows', async () => {
    const { requestHttp, calls } = respondWith(Response.json(BODY));
    const read = await requestUsage('token-1', requestHttp);
    expect(read).toEqual({
      ok: true,
      windows: parseUsageWindows(BODY),
      fastMode: 'needs_credits',
      extraUsage: { enabled: false, noLimit: false, credit: null },
      resetGrants: [],
    });
    expect(calls[0]?.[0]).toBe('https://api.anthropic.com/api/oauth/usage?cedar_ember=1');
    expect(Object.fromEntries(new Headers(calls[0]?.[1].headers))).toEqual({
      authorization: 'Bearer token-1',
      'anthropic-beta': 'oauth-2025-04-20',
      'user-agent': 'claude-cli/2.1.321 (external, cli)',
    });
    expect(calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  test('an answer with reset status carries the account’s live resets', async () => {
    const body = { ...BODY, cedar_ember: RESET_STATUS };
    const read = await requestUsage('token-1', respondWith(Response.json(body)).requestHttp);
    expect(read).toMatchObject({ ok: true, resetGrants: parseResetGrants(body) });
    expect(read.ok && read.resetGrants?.map((grant) => grant.id)).toEqual([
      'full-reset-2611',
      'launch-2610-fable-6mo',
    ]);
  });

  test('an expired login says Shinsa refreshes it', async () => {
    const { requestHttp } = respondWith(new Response('', { status: 401 }));
    expect(await requestUsage('t', requestHttp)).toEqual({
      ok: false,
      reason: 'expired',
      detail:
        'This login expired. Shinsa refreshes it at its next check. Sign in again if this message stays.',
      retryAfterMs: null,
    });
  });

  test('a 429 asks to read less often and keeps Retry-After in milliseconds', async () => {
    const limited = respondWith(new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    expect(await requestUsage('t', limited.requestHttp)).toEqual({
      ok: false,
      reason: 'limited',
      detail: 'Rate limited by Claude.',
      retryAfterMs: 30_000,
    });
    for (const header of [{}, { 'retry-after': 'later' }, { 'retry-after': '0' }]) {
      const read = await requestUsage(
        't',
        respondWith(new Response('', { status: 429, headers: header })).requestHttp
      );
      expect(read).toMatchObject({ reason: 'limited', retryAfterMs: null });
    }
  });

  test('Retry-After is read from any response, in milliseconds', () => {
    expect(readRetryAfter(new Response('', { headers: { 'retry-after': '2' } }))).toBe(2_000);
    expect(readRetryAfter(new Response(''))).toBeNull();
  });

  test('another error status names the status', async () => {
    const { requestHttp } = respondWith(new Response('', { status: 503 }));
    expect(await requestUsage('t', requestHttp)).toEqual({
      ok: false,
      reason: 'failed',
      detail: 'Claude answered 503.',
      retryAfterMs: null,
    });
  });

  test('an unreachable endpoint or an unreadable answer is a failed read with the reason', async () => {
    const offline = respondWith(() => Promise.reject(new Error('getaddrinfo ENOTFOUND api.anthropic.com')));
    expect(await requestUsage('t', offline.requestHttp)).toEqual({
      ok: false,
      reason: 'failed',
      detail: 'Could not reach Claude: getaddrinfo ENOTFOUND api.anthropic.com',
      retryAfterMs: null,
    });
    const garbled = await requestUsage('t', respondWith(new Response('<html>', { status: 200 })).requestHttp);
    expect(garbled).toMatchObject({ ok: false, reason: 'failed', retryAfterMs: null });
    expect(garbled.ok === false && garbled.detail).toStartWith('Claude’s answer could not be read: ');
  });
});
