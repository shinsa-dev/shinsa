import type {
  ExtraUsage as AccountExtraUsage,
  FastModeAvailability,
  UsageMoney,
  UsageResetGrant,
  UsageWindow,
} from '@shinsa/core';
import { Option, Predicate, Schema } from 'effect';
import {
  DEFAULT_CREDIT_CURRENCY,
  DEFAULT_CREDIT_EXPONENT,
  ExtraUsage,
  KEYED_WINDOWS,
  type KeyedWindow,
  LIMIT_KINDS,
  UsageBody,
  UsageKeyedEntry,
  UsageLimitEntry,
  UsageLimitScope,
  UsageMoneyEntry,
  UsageResetGrantEntry,
  UsageResetProgram,
  UsageSpend,
} from '../schema.ts';

const decodeBody = Schema.decodeUnknownOption(UsageBody);

const decodeLimit = Schema.decodeUnknownOption(UsageLimitEntry);

const decodeScope = Schema.decodeUnknownOption(UsageLimitScope);

const decodeKeyed = Schema.decodeUnknownOption(UsageKeyedEntry);

const decodeExtra = Schema.decodeUnknownOption(ExtraUsage);

const decodeSpend = Schema.decodeUnknownOption(UsageSpend);

const decodeMoney = Schema.decodeUnknownOption(UsageMoneyEntry);

const decodeProgram = Schema.decodeUnknownOption(UsageResetProgram);

const decodeGrant = Schema.decodeUnknownOption(UsageResetGrantEntry);

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function parseResetTime(value: unknown) {
  if (!Predicate.isString(value)) return null;
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

function readLimit(value: unknown): UsageWindow[] {
  return Option.toArray(
    Option.flatMap(decodeLimit(value), (limit) => {
      const usedPercent = clampPercent(limit.percent);
      const resetsAt = parseResetTime(limit.resets_at);
      const keyed = LIMIT_KINDS[limit.kind];
      if (keyed) return Option.some({ ...(KEYED_WINDOWS[keyed] as KeyedWindow), usedPercent, resetsAt });
      return Option.map(decodeScope(limit.scope), ({ model }) => ({
        id: `weekly:${resolveWindowSlug(model.display_name)}`,
        kind: 'model' as const,
        label: `Weekly · ${model.display_name}`,
        model: model.display_name,
        usedPercent,
        resetsAt,
      }));
    })
  );
}

function readKeyed(body: Record<string, unknown>, key: string): UsageWindow[] {
  return Option.toArray(
    Option.map(decodeKeyed(body[key]), (window) => ({
      ...(KEYED_WINDOWS[key] as KeyedWindow),
      usedPercent: clampPercent(window.utilization),
      resetsAt: parseResetTime(window.resets_at),
    }))
  );
}

export function parseUsageWindows(value: unknown): UsageWindow[] {
  return Option.match(decodeBody(value), {
    onNone: () => [],
    onSome: (body) =>
      listDistinctWindows([
        ...(body.limits ?? []).flatMap(readLimit),
        ...Object.keys(KEYED_WINDOWS).flatMap((key) => readKeyed(body, key)),
      ]),
  });
}

export function resolveClaudeFastMode(value: unknown): FastModeAvailability {
  const body = Option.getOrUndefined(decodeBody(value));
  if (!body || !('extra_usage' in body)) return 'unknown';
  const extra = Option.getOrUndefined(decodeExtra(body.extra_usage));
  if (extra?.is_enabled !== true) return 'needs_credits';
  const limit = extra.monthly_limit ?? null;
  const used = extra.used_credits ?? 0;
  return limit !== null && used >= limit ? 'needs_credits' : 'available';
}

function resolveCredit(
  money: typeof UsageMoneyEntry.Type | undefined,
  extra: typeof ExtraUsage.Type | undefined,
  enabled: boolean
): UsageMoney | null {
  if (money && money.amount_minor > 0) {
    return { minor: money.amount_minor, exponent: money.exponent, currency: money.currency };
  }
  const limit = extra?.monthly_limit;
  if (!enabled || limit === undefined) return null;
  return {
    minor: Math.max(0, limit - (extra?.used_credits ?? 0)),
    exponent: extra?.decimal_places ?? DEFAULT_CREDIT_EXPONENT,
    currency: extra?.currency ?? DEFAULT_CREDIT_CURRENCY,
  };
}

export function parseExtraUsage(value: unknown): AccountExtraUsage | null {
  const body = Option.getOrUndefined(decodeBody(value));
  if (!body) return null;
  const extra = Option.getOrUndefined(decodeExtra(body.extra_usage));
  const spend = Option.getOrUndefined(decodeSpend(body.spend));
  if (!extra && !spend) return null;
  const enabled = extra ? extra.is_enabled === true : spend?.enabled === true;
  const balance = Option.getOrUndefined(decodeMoney(spend?.balance));
  const credit = resolveCredit(balance, extra, enabled);
  return { enabled, noLimit: enabled && extra?.monthly_limit === undefined && balance === undefined, credit };
}

function readGrant(value: unknown): UsageResetGrant[] {
  return Option.toArray(
    Option.flatMap(decodeGrant(value), (grant) => {
      if (grant.resets_left <= 0) return Option.none();
      return Option.some({
        id: grant.id,
        label: grant.label ?? null,
        left: grant.resets_left,
        total: Math.max(grant.resets_total ?? grant.resets_left, grant.resets_left),
        clears: (grant.clears ?? []).filter(Predicate.isString),
        usableNow: grant.usable_now === true && grant.paused !== true,
        endsAt: parseResetTime(grant.ends_at),
      });
    })
  );
}

export function parseResetGrants(value: unknown): UsageResetGrant[] {
  const body = Option.getOrUndefined(decodeBody(value));
  if (!body) return [];
  const grants = Option.match(decodeProgram(body.cedar_ember), {
    onNone: () => [],
    onSome: (program) => (program.grants ?? []).flatMap(readGrant),
  });
  const seen = new Set<string>();
  return grants.filter((grant) => {
    if (seen.has(grant.id)) return false;
    seen.add(grant.id);
    return true;
  });
}

export function parseRetryAfter(header: string | null | undefined) {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
