import { Option } from 'effect';
import { resolveModelFamily } from '../agent-models/index.ts';
import type { UsageLimitScope, WeeklyReading } from '../domain/index.ts';
import { HOUR_MS } from '../domain/time.ts';
import type { AccountUsage, UsageWindow } from '../protocol/accounts.ts';

const SPENT_PERCENT = 100;

export const STALE_USAGE_MS = 6 * HOUR_MS;

const SHARED_WINDOW_KINDS: ReadonlySet<UsageWindow['kind']> = new Set(['session', 'weekly']);

export function isStaleUsage(usage: AccountUsage, now: number) {
  return usage.checkedAt !== null && now - usage.checkedAt > STALE_USAGE_MS;
}

function isModelWindowFor(window: UsageWindow, model: string | null) {
  if (window.kind !== 'model') return true;
  if (model === null || window.model === null) return true;
  return window.model.toLowerCase() === resolveModelFamily(model).toLowerCase();
}

export function listRelevantWindows(usage: AccountUsage, model: string | null) {
  return usage.windows.filter((window) => window.kind !== 'other' && isModelWindowFor(window, model));
}

export function resolveUsedPercent(usage: AccountUsage, model: string | null): Option.Option<number> {
  const windows = listRelevantWindows(usage, model);
  if (windows.length === 0) return Option.none();
  return Option.some(Math.max(...windows.map((window) => window.usedPercent)));
}

export function resolveHeadroom(usage: AccountUsage, model: string | null) {
  return Option.map(resolveUsedPercent(usage, model), (used) => Math.max(0, SPENT_PERCENT - used));
}

export function resolveSpentUntil(
  usage: AccountUsage,
  model: string | null,
  now: number
): Option.Option<number> {
  const resets = listSpentWindows(usage, model, now).map((window) => window.resetsAt as number);
  if (resets.length === 0) return Option.none();
  return Option.some(Math.max(...resets));
}

export function isSharedWindow(window: UsageWindow) {
  return SHARED_WINDOW_KINDS.has(window.kind);
}

export function listSpentWindows(usage: AccountUsage, model: string | null, now: number) {
  if (isStaleUsage(usage, now)) return [];
  return listRelevantWindows(usage, model).filter(
    (window) => window.usedPercent >= SPENT_PERCENT && window.resetsAt !== null && window.resetsAt > now
  );
}

function selectWeeklyWindow(usage: AccountUsage) {
  return Option.fromNullishOr(usage.windows.find((window) => window.kind === 'weekly'));
}

export function resolveWeeklyPercent(usage: AccountUsage) {
  return Option.map(selectWeeklyWindow(usage), (window) => window.usedPercent);
}

export function resolveWeeklyReading(usage: AccountUsage): Option.Option<WeeklyReading> {
  const { checkedAt } = usage;
  if (checkedAt === null || usage.source === 'push') return Option.none();
  return Option.map(selectWeeklyWindow(usage), (window) => ({
    percent: window.usedPercent,
    at: checkedAt,
    resetsAt: window.resetsAt,
  }));
}

function isSameFamily(a: string, b: string) {
  return resolveModelFamily(a).toLowerCase() === resolveModelFamily(b).toLowerCase();
}

export function isModelMarkFor(markModel: string | null | undefined, model: string | null) {
  if (!markModel || model === null) return true;
  return isSameFamily(markModel, model);
}

function listOwnModelWindows(usage: AccountUsage, model: string | null) {
  if (model === null) return [];
  return usage.windows.filter(
    (window) => window.kind === 'model' && window.model !== null && isSameFamily(window.model, model)
  );
}

export function listWeeklyWindows(usage: AccountUsage, model: string | null) {
  return [...Option.toArray(selectWeeklyWindow(usage)), ...listOwnModelWindows(usage, model)];
}

export function resolveLimitScope(usage: AccountUsage, model: string | null, now: number): UsageLimitScope {
  if (model === null) return 'account';
  if (usage.checkedAt === null || isStaleUsage(usage, now)) return 'account';
  const own = listOwnModelWindows(usage, model);
  if (own.length === 0) return 'account';
  const shared = usage.windows.filter(isSharedWindow);
  if (shared.some((window) => window.usedPercent >= SPENT_PERCENT)) return 'account';
  const ownPercent = Math.max(...own.map((window) => window.usedPercent));
  return shared.every((window) => window.usedPercent <= ownPercent) ? 'model' : 'account';
}
