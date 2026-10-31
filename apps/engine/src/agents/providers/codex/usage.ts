import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastModeAvailability, UsageWindow } from '@shinsa/core';
import {
  type KeyedWindow,
  listDistinctWindows,
  PROVIDER_WINDOWS,
  readRetryAfter,
  type UsageRequester,
} from '../../../accounts/usage.ts';
import { describeError } from '../../../log/index.ts';
import type { ProviderUsageReading } from '../types.ts';
import { CodexClient } from './client.ts';
import type { CodexRuntime } from './session.ts';

export interface CodexUsageOptions {
  requestHttp?: UsageRequester;
  env?: Record<string, string | undefined>;
  now?: () => number;
  timeoutMs?: number;
}

type Fields = Record<string, unknown>;

interface RawWindow {
  usedPercent: number;
  minutes: number;
  resetsAt: number | null;
}

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';

const USAGE_TIMEOUT_MS = 10_000;

const SESSION_MINUTES = 300;

const WEEK_MINUTES = 10_080;

const MAIN_LIMIT = 'codex';

const SIGNED_OUT = 'Codex is signed out. Run `codex login` in a terminal.';

const NOT_CHATGPT = 'Codex reports usage limits only when it is signed in with ChatGPT.';

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLooseNumber(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

function readTrimmedText(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const CODEX_WINDOW_KEYS: Record<number, string> = {
  [SESSION_MINUTES]: 'five_hour',
  [WEEK_MINUTES]: 'seven_day',
};

function describeMinutes(minutes: number) {
  const keyed = CODEX_WINDOW_KEYS[minutes];
  if (keyed) return (PROVIDER_WINDOWS[keyed] as KeyedWindow).label;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function resolveLimitSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
}

export function createCodexWindow(raw: RawWindow, limitName: string | null = null): UsageWindow {
  const usedPercent = Math.min(100, Math.max(0, raw.usedPercent));
  if (limitName) {
    return {
      id: `${resolveLimitSlug(limitName)}:${raw.minutes}m`,
      kind: 'model',
      label: `${limitName} · ${describeMinutes(raw.minutes)}`,
      model: limitName,
      usedPercent,
      resetsAt: raw.resetsAt,
    };
  }
  const keyed = CODEX_WINDOW_KEYS[raw.minutes];
  if (keyed) return { ...(PROVIDER_WINDOWS[keyed] as KeyedWindow), usedPercent, resetsAt: raw.resetsAt };
  return {
    id: `${raw.minutes}m`,
    kind: 'other',
    label: describeMinutes(raw.minutes),
    model: null,
    usedPercent,
    resetsAt: raw.resetsAt,
  };
}

function readOAuthWindow(value: unknown, now: number): RawWindow | null {
  if (!isFields(value)) return null;
  const usedPercent = readLooseNumber(value, 'used_percent');
  const seconds = readLooseNumber(value, 'limit_window_seconds');
  if (usedPercent === null || seconds === null || seconds <= 0) return null;
  const resetAt = readLooseNumber(value, 'reset_at');
  const resetAfter = readLooseNumber(value, 'reset_after_seconds');
  let resetsAt: number | null = null;
  if (resetAt !== null && resetAt > 0) resetsAt = resetAt * 1000;
  else if (resetAfter !== null && resetAfter >= 0) resetsAt = now + resetAfter * 1000;
  return { usedPercent, minutes: Math.round(seconds / 60), resetsAt };
}

function listOAuthWindows(rateLimit: unknown, now: number, limitName: string | null = null) {
  if (!isFields(rateLimit)) return [];
  return [rateLimit.primary_window, rateLimit.secondary_window].flatMap((value) => {
    const raw = readOAuthWindow(value, now);
    return raw ? [createCodexWindow(raw, limitName)] : [];
  });
}

export function resolveCodexFastMode(credits: unknown): FastModeAvailability {
  if (credits === undefined) return 'unknown';
  if (!isFields(credits)) return 'needs_credits';
  return credits.has_credits === true || credits.hasCredits === true || credits.unlimited === true
    ? 'available'
    : 'needs_credits';
}

export function parseCodexOAuthUsage(body: unknown, now: number) {
  if (!isFields(body)) return { windows: [], email: null, plan: null, fastMode: 'unknown' as const };
  const extra = Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : [];
  const windows = [
    ...listOAuthWindows(body.rate_limit, now),
    ...extra.flatMap((limit) =>
      isFields(limit)
        ? listOAuthWindows(
            limit.rate_limit,
            now,
            readTrimmedText(limit, 'limit_name') ?? readTrimmedText(limit, 'metered_feature')
          )
        : []
    ),
  ];
  return {
    windows: listDistinctWindows(windows),
    email: readTrimmedText(body, 'email'),
    plan: readTrimmedText(body, 'plan_type'),
    fastMode: resolveCodexFastMode(body.credits),
  };
}

function readAppServerWindow(value: unknown): RawWindow | null {
  if (!isFields(value)) return null;
  const usedPercent = readLooseNumber(value, 'usedPercent');
  const minutes = readLooseNumber(value, 'windowDurationMins');
  if (usedPercent === null || minutes === null || minutes <= 0) return null;
  const resetsAt = readLooseNumber(value, 'resetsAt');
  return { usedPercent, minutes, resetsAt: resetsAt !== null && resetsAt > 0 ? resetsAt * 1000 : null };
}

function listSnapshotWindows(snapshot: unknown, limitName: string | null = null) {
  if (!isFields(snapshot)) return [];
  return [snapshot.primary, snapshot.secondary].flatMap((value) => {
    const raw = readAppServerWindow(value);
    return raw ? [createCodexWindow(raw, limitName)] : [];
  });
}

export function parseCodexRateLimits(response: unknown) {
  if (!isFields(response)) return { windows: [], plan: null, fastMode: 'unknown' as const };
  const byLimit = isFields(response.rateLimitsByLimitId) ? response.rateLimitsByLimitId : {};
  const extra = Object.entries(byLimit).flatMap(([id, snapshot]) => {
    if (id === MAIN_LIMIT || !isFields(snapshot)) return [];
    return listSnapshotWindows(snapshot, readTrimmedText(snapshot, 'limitName') ?? id);
  });
  const main = isFields(response.rateLimits) ? response.rateLimits : {};
  return {
    windows: listDistinctWindows([...listSnapshotWindows(main), ...extra]),
    plan: readTrimmedText(main, 'planType'),
    fastMode: resolveCodexFastMode(main.credits),
  };
}

export function resolveCodexHome(env: Record<string, string | undefined>) {
  return env.CODEX_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.codex');
}

export function parseChatGptBaseUrl(config: string) {
  for (const raw of config.split(/\r?\n/)) {
    const line = (raw.split('#')[0] ?? '').trim();
    if (line.startsWith('[')) return null;
    const match = /^chatgpt_base_url\s*=\s*(.+)$/.exec(line);
    if (match?.[1])
      return match[1]
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
        .trim();
  }
  return null;
}

export function resolveCodexUsageUrl(base: string | null) {
  let url = (base?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const chatgpt = url.startsWith('https://chatgpt.com') || url.startsWith('https://chat.openai.com');
  if (chatgpt && !url.includes('/backend-api')) url = `${url}/backend-api`;
  return url.includes('/backend-api') ? `${url}/wham/usage` : `${url}/api/codex/usage`;
}

function readFile(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function readCodexOAuthLogin(home: string) {
  try {
    const auth: unknown = JSON.parse(readFile(join(home, 'auth.json')) ?? 'null');
    const tokens = isFields(auth) && isFields(auth.tokens) ? auth.tokens : null;
    const accessToken = tokens ? readTrimmedText(tokens, 'access_token') : null;
    if (!tokens || !accessToken) return null;
    return { accessToken, accountId: readTrimmedText(tokens, 'account_id') };
  } catch {
    return null;
  }
}

function fail(reason: 'expired' | 'limited' | 'failed', detail: string, retryAfterMs: number | null = null) {
  return { ok: false as const, reason, detail, retryAfterMs };
}

async function requestOAuthUsage(
  options: CodexUsageOptions,
  now: number
): Promise<ProviderUsageReading | null> {
  const home = resolveCodexHome({ ...Bun.env, ...options.env });
  const login = readCodexOAuthLogin(home);
  if (!login) return null;
  const url = resolveCodexUsageUrl(parseChatGptBaseUrl(readFile(join(home, 'config.toml')) ?? ''));
  let response: Response;
  try {
    response = await (options.requestHttp ?? fetch)(url, {
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'shinsa',
        ...(login.accountId ? { 'ChatGPT-Account-Id': login.accountId } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? USAGE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      read: fail('failed', `Could not reach Codex: ${describeError(error)}`),
      email: null,
      plan: null,
    };
  }
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 429) {
    return {
      read: fail('limited', 'Rate limited by Codex.', readRetryAfter(response)),
      email: null,
      plan: null,
    };
  }
  if (!response.ok)
    return { read: fail('failed', `Codex answered ${response.status}.`), email: null, plan: null };
  try {
    const parsed = parseCodexOAuthUsage(await response.json(), now);
    return {
      read: { ok: true, windows: parsed.windows, fastMode: parsed.fastMode },
      email: parsed.email,
      plan: parsed.plan,
    };
  } catch (error) {
    return {
      read: fail('failed', `Codex’s answer could not be read: ${describeError(error)}`),
      email: null,
      plan: null,
    };
  }
}

async function requestAppServerUsage(
  runtime: CodexRuntime,
  timeoutMs: number
): Promise<ProviderUsageReading> {
  const executable = await runtime.resolveExecutable();
  if (!executable.ok) return { read: fail('failed', executable.message), email: null, plan: null };
  const client = new CodexClient({ path: executable.path, cwd: tmpdir(), env: runtime.env });
  const timer = setTimeout(() => client.close(), timeoutMs);
  try {
    await client.initialize();
    const account = await client.request('account/read', { refreshToken: false });
    const identity = isFields(account.account) ? account.account : null;
    if (!identity) return { read: fail('expired', SIGNED_OUT), email: null, plan: null };
    const email = readTrimmedText(identity, 'email');
    if (identity.type === 'apiKey')
      return { read: { ok: true, windows: [], fastMode: 'available' }, email, plan: null };
    if (identity.type !== 'chatgpt') return { read: fail('failed', NOT_CHATGPT), email, plan: null };
    const parsed = parseCodexRateLimits(await client.request('account/rateLimits/read', {}));
    return {
      read: { ok: true, windows: parsed.windows, fastMode: parsed.fastMode },
      email,
      plan: parsed.plan ?? readTrimmedText(identity, 'planType'),
    };
  } catch (error) {
    return {
      read: fail('failed', `Codex could not report its usage: ${describeError(error)}`),
      email: null,
      plan: null,
    };
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

export async function readCodexUsage(
  runtime: CodexRuntime,
  options: CodexUsageOptions = {}
): Promise<ProviderUsageReading> {
  const now = (options.now ?? Date.now)();
  const oauth = await requestOAuthUsage(options, now);
  return oauth ?? requestAppServerUsage(runtime, options.timeoutMs ?? USAGE_TIMEOUT_MS);
}
