import { describe, expect, test } from 'bun:test';
import {
  parseResetTime,
  parseUsageWindows,
  requestUsage,
  resolveClaudeFastMode,
  USAGE_URL,
  type UsageRequester,
} from '../../src/accounts/usage.ts';

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

describe('requestUsage', () => {
  test('asks the usage endpoint with the account’s token and reads the windows', async () => {
    const { requestHttp, calls } = respondWith(Response.json(BODY));
    const read = await requestUsage('token-1', requestHttp);
    expect(read).toEqual({ ok: true, windows: parseUsageWindows(BODY), fastMode: 'needs_credits' });
    expect(calls[0]?.[0]).toBe(USAGE_URL);
    expect(calls[0]?.[1].headers).toEqual({
      Authorization: 'Bearer token-1',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'shinsa',
    });
    expect(calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  test('an expired login says it refreshes on the next run', async () => {
    const { requestHttp } = respondWith(new Response('', { status: 401 }));
    expect(await requestUsage('t', requestHttp)).toEqual({
      ok: false,
      reason: 'expired',
      detail: 'The login needs refreshing. It refreshes the next time an agent runs on this account.',
      retryAfterMs: null,
    });
  });

  test('a 429 asks to read less often and keeps Retry-After in milliseconds', async () => {
    const limited = respondWith(new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    expect(await requestUsage('t', limited.requestHttp)).toEqual({
      ok: false,
      reason: 'limited',
      detail: 'Claude asked Shinsa to read usage less often.',
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
