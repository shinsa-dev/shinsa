import type { FastModeAvailability, UsageWindow, UsageWindowKind } from '@shinsa/core';
import { describeError } from '../log/index.ts';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const USAGE_TIMEOUT_MS = 5_000;

const TOO_MANY_REQUESTS = 429;

const UNAUTHORIZED = 401;

type Fields = Record<string, unknown>;

export type UsageRequester = (url: string, init: RequestInit) => Promise<Response>;

export type UsageRead =
  | { ok: true; windows: UsageWindow[]; fastMode?: FastModeAvailability }
  | { ok: false; reason: 'expired' | 'limited' | 'failed'; detail: string; retryAfterMs: number | null };

export interface KeyedWindow {
  id: string;
  kind: UsageWindowKind;
  label: string;
  model: string | null;
}

export const KEYED_WINDOWS: Record<string, KeyedWindow> = {
  five_hour: { id: 'five_hour', kind: 'session', label: '5-hour limit', model: null },
  seven_day: { id: 'seven_day', kind: 'weekly', label: 'Weekly · All models', model: null },
  seven_day_opus: { id: 'weekly:opus', kind: 'model', label: 'Weekly · Opus', model: 'Opus' },
  seven_day_sonnet: { id: 'weekly:sonnet', kind: 'model', label: 'Weekly · Sonnet', model: 'Sonnet' },
};

export const PROVIDER_WINDOWS: Record<string, KeyedWindow> = {
  five_hour: { id: 'five_hour', kind: 'session', label: '5-hour limit', model: null },
  seven_day: { id: 'seven_day', kind: 'weekly', label: 'Weekly limit', model: null },
};

const LIMIT_KINDS: Record<string, string> = { session: 'five_hour', weekly_all: 'seven_day' };

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampPercent(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function parseResetTime(value: unknown) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function resolveWindowSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function resolveWindowId(name: string) {
  return KEYED_WINDOWS[name]?.id ?? name;
}

export function listDistinctWindows(windows: UsageWindow[]) {
  const seen = new Set<string>();
  return windows.filter((window) => {
    if (seen.has(window.id)) return false;
    seen.add(window.id);
    return true;
  });
}

function readLimit(limit: unknown): UsageWindow | null {
  if (!isFields(limit)) return null;
  const usedPercent = clampPercent(limit.percent);
  if (usedPercent === null || typeof limit.kind !== 'string') return null;
  const resetsAt = parseResetTime(limit.resets_at);
  const keyed = LIMIT_KINDS[limit.kind];
  if (keyed) return { ...(KEYED_WINDOWS[keyed] as KeyedWindow), usedPercent, resetsAt };
  const scope = isFields(limit.scope) ? limit.scope : null;
  const model =
    isFields(scope?.model) && typeof scope.model.display_name === 'string' ? scope.model.display_name : null;
  if (!model) return null;
  return {
    id: `weekly:${resolveWindowSlug(model)}`,
    kind: 'model',
    label: `Weekly · ${model}`,
    model,
    usedPercent,
    resetsAt,
  };
}

function readKeyed(body: Fields, key: string): UsageWindow | null {
  const window = body[key];
  if (!isFields(window)) return null;
  const usedPercent = clampPercent(window.utilization);
  if (usedPercent === null) return null;
  return { ...(KEYED_WINDOWS[key] as KeyedWindow), usedPercent, resetsAt: parseResetTime(window.resets_at) };
}

export function parseUsageWindows(body: unknown): UsageWindow[] {
  if (!isFields(body)) return [];
  const fromLimits = (Array.isArray(body.limits) ? body.limits : [])
    .map(readLimit)
    .filter((window): window is UsageWindow => window !== null);
  const keyed = Object.keys(KEYED_WINDOWS)
    .map((key) => readKeyed(body, key))
    .filter((window): window is UsageWindow => window !== null);
  return listDistinctWindows([...fromLimits, ...keyed]);
}

function readCredit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolveClaudeFastMode(body: unknown): FastModeAvailability {
  if (!isFields(body) || !('extra_usage' in body)) return 'unknown';
  const extra = body.extra_usage;
  if (!isFields(extra) || extra.is_enabled !== true) return 'needs_credits';
  const limit = readCredit(extra.monthly_limit);
  const used = readCredit(extra.used_credits) ?? 0;
  return limit !== null && used >= limit ? 'needs_credits' : 'available';
}

export function readRetryAfter(response: Response) {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export async function requestUsage(
  accessToken: string,
  requestHttp: UsageRequester = fetch
): Promise<UsageRead> {
  let response: Response;
  try {
    response = await requestHttp(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'shinsa',
      },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: `Could not reach Claude: ${describeError(error)}`,
      retryAfterMs: null,
    };
  }
  if (response.status === UNAUTHORIZED) {
    return {
      ok: false,
      reason: 'expired',
      detail: 'The login needs refreshing. It refreshes the next time an agent runs on this account.',
      retryAfterMs: null,
    };
  }
  if (response.status === TOO_MANY_REQUESTS) {
    return {
      ok: false,
      reason: 'limited',
      detail: 'Claude asked Shinsa to read usage less often.',
      retryAfterMs: readRetryAfter(response),
    };
  }
  if (!response.ok) {
    return { ok: false, reason: 'failed', detail: `Claude answered ${response.status}.`, retryAfterMs: null };
  }
  try {
    const body: unknown = await response.json();
    return { ok: true, windows: parseUsageWindows(body), fastMode: resolveClaudeFastMode(body) };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: `Claude’s answer could not be read: ${describeError(error)}`,
      retryAfterMs: null,
    };
  }
}
