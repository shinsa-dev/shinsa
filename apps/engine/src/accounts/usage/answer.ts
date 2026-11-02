import type { FastModeAvailability, UsageWindow } from '@shinsa/core';
import { Option, Predicate, Schema } from 'effect';
import {
  ExtraUsage,
  KEYED_WINDOWS,
  type KeyedWindow,
  LIMIT_KINDS,
  UsageBody,
  UsageKeyedEntry,
  UsageLimitEntry,
  UsageLimitScope,
} from '../schema.ts';

const decodeBody = Schema.decodeUnknownOption(UsageBody);

const decodeLimit = Schema.decodeUnknownOption(UsageLimitEntry);

const decodeScope = Schema.decodeUnknownOption(UsageLimitScope);

const decodeKeyed = Schema.decodeUnknownOption(UsageKeyedEntry);

const decodeExtra = Schema.decodeUnknownOption(ExtraUsage);

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

export function parseRetryAfter(header: string | null | undefined) {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
