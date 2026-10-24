import { resolveModelFamily } from '../agent-models/index.ts';
import type { AccountUsage, UsageWindow } from '../protocol/accounts.ts';

const SPENT_PERCENT = 100;

function isModelWindowFor(window: UsageWindow, model: string | null) {
  if (window.kind !== 'model') return true;
  if (model === null || window.model === null) return true;
  return window.model.toLowerCase() === resolveModelFamily(model).toLowerCase();
}

export function listRelevantWindows(usage: AccountUsage, model: string | null) {
  return usage.windows.filter((window) => window.kind !== 'other' && isModelWindowFor(window, model));
}

export function resolveUsedPercent(usage: AccountUsage, model: string | null) {
  const windows = listRelevantWindows(usage, model);
  if (windows.length === 0) return null;
  return Math.max(...windows.map((window) => window.usedPercent));
}

export function resolveHeadroom(usage: AccountUsage, model: string | null) {
  const used = resolveUsedPercent(usage, model);
  return used === null ? null : Math.max(0, SPENT_PERCENT - used);
}

export function resolveSpentUntil(usage: AccountUsage, model: string | null, now: number) {
  const spent = listRelevantWindows(usage, model).filter(
    (window) => window.usedPercent >= SPENT_PERCENT && window.resetsAt !== null && window.resetsAt > now
  );
  if (spent.length === 0) return null;
  return Math.max(...spent.map((window) => window.resetsAt as number));
}

export function resolveWeeklyPercent(usage: AccountUsage) {
  return usage.windows.find((window) => window.kind === 'weekly')?.usedPercent ?? null;
}

export function resolveWeeklyUsed(before: number | null, after: number | null) {
  if (before === null || after === null) return null;
  return after >= before ? after - before : after;
}
