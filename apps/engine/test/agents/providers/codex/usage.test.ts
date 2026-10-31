import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageRequester } from '../../../../src/accounts/usage.ts';
import type { CodexRuntime } from '../../../../src/agents/providers/codex/session.ts';
import {
  createCodexWindow,
  parseChatGptBaseUrl,
  parseCodexOAuthUsage,
  parseCodexRateLimits,
  readCodexOAuthLogin,
  readCodexUsage,
  resolveCodexFastMode,
  resolveCodexHome,
  resolveCodexUsageUrl,
} from '../../../../src/agents/providers/codex/usage.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { createTempDir } from '../../../helpers/index.ts';

const NOW = 1_800_000_000_000;

const MISSING: CodexRuntime = {
  resolveExecutable: () =>
    Promise.resolve({ ok: false, reason: 'not_installed', message: 'No codex.', version: null }),
};

const OAUTH_BODY = {
  email: 'codex@example.com',
  plan_type: 'pro',
  rate_limit: {
    primary_window: { used_percent: 15, reset_at: 1_800_000_600, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 5, reset_after_seconds: 3600, limit_window_seconds: 604_800 },
  },
  additional_rate_limits: [
    {
      limit_name: 'GPT-6-Astra',
      rate_limit: { primary_window: { used_percent: '40', limit_window_seconds: 604_800 } },
    },
    {
      metered_feature: 'codex_cloud',
      rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 7200 } },
    },
    'not a limit',
  ],
  credits: { has_credits: false, unlimited: false, balance: '0' },
};

function createHome(auth: unknown, config = '') {
  const home = createTempDir('shinsa-codex-home-');
  if (auth !== undefined)
    writeFileSync(join(home, 'auth.json'), typeof auth === 'string' ? auth : JSON.stringify(auth));
  if (config) writeFileSync(join(home, 'config.toml'), config);
  return home;
}

const SIGNED_IN = { tokens: { access_token: 'access-1', account_id: 'account-1' } };

function respondWith(response: Response | Error) {
  const calls: [string, RequestInit][] = [];
  const requestHttp: UsageRequester = (url, init) => {
    calls.push([url, init]);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  };
  return { requestHttp, calls };
}

describe('Codex usage windows', () => {
  test('the five-hour and weekly windows are the session and the weekly limit', () => {
    expect(createCodexWindow({ usedPercent: 120, minutes: 300, resetsAt: 5 })).toEqual({
      id: 'five_hour',
      kind: 'session',
      label: '5-hour limit',
      model: null,
      usedPercent: 100,
      resetsAt: 5,
    });
    expect(createCodexWindow({ usedPercent: -3, minutes: 10_080, resetsAt: null })).toMatchObject({
      id: 'seven_day',
      kind: 'weekly',
      usedPercent: 0,
    });
  });

  test('other lengths are named by days, hours or minutes, and a named limit is a model window', () => {
    expect(createCodexWindow({ usedPercent: 1, minutes: 2880, resetsAt: null }).label).toBe('2-day limit');
    expect(createCodexWindow({ usedPercent: 1, minutes: 120, resetsAt: null })).toMatchObject({
      id: '120m',
      kind: 'other',
      label: '2-hour limit',
    });
    expect(createCodexWindow({ usedPercent: 1, minutes: 45, resetsAt: null }).label).toBe('45-minute limit');
    expect(createCodexWindow({ usedPercent: 9, minutes: 10_080, resetsAt: null }, 'GPT-6 Astra')).toEqual({
      id: 'gpt-6-astra:10080m',
      kind: 'model',
      label: 'GPT-6 Astra · Weekly limit',
      model: 'GPT-6 Astra',
      usedPercent: 9,
      resetsAt: null,
    });
  });
});

describe('Codex’s usage endpoint, read the way CodexBar reads it', () => {
  test('reads both windows, every extra limit, the email, the plan and whether credits are there', () => {
    const parsed = parseCodexOAuthUsage(OAUTH_BODY, NOW);
    expect(parsed.email).toBe('codex@example.com');
    expect(parsed.plan).toBe('pro');
    expect(parsed.fastMode).toBe('needs_credits');
    expect(parsed.windows.map((window) => [window.id, window.usedPercent, window.resetsAt])).toEqual([
      ['five_hour', 15, 1_800_000_600_000],
      ['seven_day', 5, NOW + 3_600_000],
      ['gpt-6-astra:10080m', 40, null],
      ['codex-cloud:120m', 2, null],
    ]);
  });

  test('a window without a length or a percentage is left out, and a body that is not an object reads as nothing', () => {
    const parsed = parseCodexOAuthUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 10 },
          secondary_window: { used_percent: 'many', limit_window_seconds: 60 },
        },
        additional_rate_limits: [
          { rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 0 } } },
        ],
      },
      NOW
    );
    expect(parsed).toEqual({ windows: [], email: null, plan: null, fastMode: 'unknown' });
    expect(parseCodexOAuthUsage([], NOW)).toEqual({
      windows: [],
      email: null,
      plan: null,
      fastMode: 'unknown',
    });
    expect(parseCodexOAuthUsage({ rate_limit: 'none' }, NOW).windows).toEqual([]);
  });

  test('fast mode needs credits on the account: some, or unlimited', () => {
    expect(resolveCodexFastMode({ has_credits: true, unlimited: false })).toBe('available');
    expect(resolveCodexFastMode({ hasCredits: true })).toBe('available');
    expect(resolveCodexFastMode({ has_credits: false, unlimited: true })).toBe('available');
    expect(resolveCodexFastMode({ has_credits: false })).toBe('needs_credits');
    expect(resolveCodexFastMode(null)).toBe('needs_credits');
    expect(resolveCodexFastMode(undefined)).toBe('unknown');
  });

  test('the address follows chatgpt_base_url in config.toml, as Codex does', () => {
    expect(resolveCodexUsageUrl(null)).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(resolveCodexUsageUrl('https://chatgpt.com/')).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(resolveCodexUsageUrl('https://chat.openai.com')).toBe(
      'https://chat.openai.com/backend-api/wham/usage'
    );
    expect(resolveCodexUsageUrl('https://proxy.example.com/backend-api/')).toBe(
      'https://proxy.example.com/backend-api/wham/usage'
    );
    expect(resolveCodexUsageUrl('https://proxy.example.com')).toBe(
      'https://proxy.example.com/api/codex/usage'
    );
    expect(
      parseChatGptBaseUrl('# chatgpt_base_url = "https://no"\nchatgpt_base_url = "https://yes" # note\n')
    ).toBe('https://yes');
    expect(parseChatGptBaseUrl("model = 'x'\nchatgpt_base_url = 'https://single'")).toBe('https://single');
    expect(parseChatGptBaseUrl('[profiles.work]\nchatgpt_base_url = "https://profile"')).toBeNull();
    expect(parseChatGptBaseUrl('model = "x"')).toBeNull();
  });

  test('the login is Codex’s own auth.json under CODEX_HOME, never refreshed by Shinsa', () => {
    expect(resolveCodexHome({ CODEX_HOME: ' /tmp/codex-home ' })).toBe('/tmp/codex-home');
    expect(resolveCodexHome({ HOME: '/Users/someone' })).toBe('/Users/someone/.codex');
    expect(resolveCodexHome({})).toBe(join(homedir(), '.codex'));
    expect(readCodexOAuthLogin(createHome(SIGNED_IN))).toEqual({
      accessToken: 'access-1',
      accountId: 'account-1',
    });
    expect(readCodexOAuthLogin(createHome({ tokens: { access_token: 'access-2' } }))).toEqual({
      accessToken: 'access-2',
      accountId: null,
    });
    expect(readCodexOAuthLogin(createHome({ OPENAI_API_KEY: 'sk-1', tokens: null }))).toBeNull();
    expect(readCodexOAuthLogin(createHome({ tokens: { access_token: '' } }))).toBeNull();
    expect(readCodexOAuthLogin(createHome('{ broken'))).toBeNull();
    expect(readCodexOAuthLogin(createHome(undefined))).toBeNull();
  });
});

describe('the app server’s rate limits', () => {
  test('reads the main windows, the plan, the credits and every other named limit', () => {
    const parsed = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_800_000_100 },
        secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 0 },
        planType: 'plus',
        credits: { hasCredits: true, unlimited: false, balance: '12' },
      },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 30, windowDurationMins: 300 } },
        astra: { limitName: 'GPT-6-Astra', primary: { usedPercent: 70, windowDurationMins: 10_080 } },
        spark: { primary: { usedPercent: 5, windowDurationMins: 300 }, secondary: { usedPercent: 1 } },
        broken: 'nope',
      },
    });
    expect(parsed.plan).toBe('plus');
    expect(parsed.fastMode).toBe('available');
    expect(parsed.windows.map((window) => [window.id, window.usedPercent, window.resetsAt])).toEqual([
      ['five_hour', 30, 1_800_000_100_000],
      ['seven_day', 60, null],
      ['gpt-6-astra:10080m', 70, null],
      ['spark:300m', 5, null],
    ]);
  });

  test('an answer that is not an object, or without a snapshot, reads as nothing', () => {
    expect(parseCodexRateLimits(null)).toEqual({ windows: [], plan: null, fastMode: 'unknown' });
    expect(parseCodexRateLimits({ rateLimits: null, rateLimitsByLimitId: null })).toEqual({
      windows: [],
      plan: null,
      fastMode: 'unknown',
    });
  });
});

describe('reading Codex’s usage', () => {
  test('signed in with ChatGPT, it asks the usage endpoint with the token and the account', async () => {
    const home = createHome(SIGNED_IN, 'chatgpt_base_url = "https://proxy.example.com/backend-api"');
    const { requestHttp, calls } = respondWith(Response.json(OAUTH_BODY));
    const reading = await readCodexUsage(MISSING, { env: { CODEX_HOME: home }, requestHttp, now: () => NOW });
    expect(reading).toMatchObject({
      read: { ok: true, fastMode: 'needs_credits' },
      email: 'codex@example.com',
      plan: 'pro',
    });
    expect(calls[0]?.[0]).toBe('https://proxy.example.com/backend-api/wham/usage');
    expect(calls[0]?.[1].headers).toEqual({
      Authorization: 'Bearer access-1',
      Accept: 'application/json',
      'User-Agent': 'shinsa',
      'ChatGPT-Account-Id': 'account-1',
    });
  });

  test('a token without an account id sends no account header', async () => {
    const home = createHome({ tokens: { access_token: 'access-2' } });
    const { requestHttp, calls } = respondWith(Response.json({}));
    await readCodexUsage(MISSING, { env: { CODEX_HOME: home }, requestHttp });
    expect(calls[0]?.[1].headers).not.toHaveProperty('ChatGPT-Account-Id');
  });

  test('a refusal to read, a 500, an unreadable answer and no network each say what went wrong', async () => {
    const home = createHome(SIGNED_IN);
    const read = (response: Response | Error) =>
      readCodexUsage(MISSING, { env: { CODEX_HOME: home }, requestHttp: respondWith(response).requestHttp });
    expect(await read(new Response('', { status: 429, headers: { 'retry-after': '120' } }))).toEqual({
      read: {
        ok: false,
        reason: 'limited',
        detail: 'Rate limited by Codex.',
        retryAfterMs: 120_000,
      },
      email: null,
      plan: null,
    });
    expect((await read(new Response('', { status: 429 }))).read).toMatchObject({ retryAfterMs: null });
    expect((await read(new Response('', { status: 500 }))).read).toMatchObject({
      reason: 'failed',
      detail: 'Codex answered 500.',
    });
    expect((await read(new Response('not json'))).read).toMatchObject({ reason: 'failed' });
    expect((await read(new Error('offline'))).read).toMatchObject({
      reason: 'failed',
      detail: 'Could not reach Codex: offline',
    });
  });

  test('a token the endpoint refuses falls back to the app server, which Codex refreshes itself', async () => {
    const home = createHome(SIGNED_IN);
    const codex = new FakeCodex({
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_100 },
        secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
        planType: 'plus',
        credits: { hasCredits: false, unlimited: false, balance: null },
      },
    });
    const reading = await readCodexUsage(codex.runtime, {
      env: { CODEX_HOME: home },
      requestHttp: respondWith(new Response('', { status: 401 })).requestHttp,
    });
    expect(reading).toMatchObject({
      read: { ok: true, fastMode: 'needs_credits' },
      email: 'codex@example.com',
      plan: 'plus',
    });
    expect(reading.read.ok && reading.read.windows.map((window) => window.usedPercent)).toEqual([20, 50]);
  });

  test.each([
    ['signed out', null, { read: { ok: false, reason: 'expired' } }],
    [
      'an API key',
      { type: 'apiKey' },
      { read: { ok: true, windows: [], fastMode: 'available' }, email: null, plan: null },
    ],
    [
      'another sign-in',
      { type: 'amazonBedrock', usesCodexManagedCredentials: false },
      { read: { ok: false, detail: 'Codex reports usage limits only when it is signed in with ChatGPT.' } },
    ],
    [
      'ChatGPT with no email',
      { type: 'chatgpt', email: null, planType: 'team' },
      { read: { ok: true, windows: [] }, email: null, plan: 'team' },
    ],
  ])('without a ChatGPT token the app server answers: %s', async (_name, account, reading) => {
    const env = { CODEX_HOME: createHome(undefined) };
    expect(await readCodexUsage(new FakeCodex({ account }).runtime, { env })).toMatchObject(reading);
  });

  test('a codex that is missing, refuses or never answers is a failed read, not a crash', async () => {
    const env = { CODEX_HOME: createHome(undefined) };
    expect((await readCodexUsage(MISSING, { env })).read).toMatchObject({ ok: false, detail: 'No codex.' });
    const refused = await readCodexUsage(new FakeCodex({ refuse: ['account/read'] }).runtime, { env });
    expect(refused.read).toMatchObject({ ok: false, reason: 'failed' });
    const silent = await readCodexUsage(new FakeCodex({ ignore: ['account/read'] }).runtime, {
      env,
      timeoutMs: 100,
    });
    expect(silent.read).toMatchObject({ ok: false, reason: 'failed' });
  });

  test('the usage file falls back to the home folder when CODEX_HOME is not set', async () => {
    const home = createTempDir('shinsa-home-');
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify(SIGNED_IN));
    const { requestHttp, calls } = respondWith(Response.json({}));
    await readCodexUsage(MISSING, { env: { CODEX_HOME: '', HOME: home }, requestHttp });
    expect(calls[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer access-1' });
  });
});
