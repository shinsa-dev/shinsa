import { DAY_MS } from '../domain/time.ts';
import type { AccountSummary, AccountUsage } from '../protocol/accounts.ts';
import type {
  ForecastAccount,
  ForecastOutage,
  ForecastReset,
  ForecastSegment,
  UsageForecast,
} from './schema.ts';

export type {
  ForecastAccount,
  ForecastOutage,
  ForecastReset,
  ForecastSegment,
  UsageForecast,
} from './schema.ts';

export const FORECAST_LIMITS = {
  horizonMs: 7 * DAY_MS,
  weekMs: 7 * DAY_MS,
  fullPercent: 100,
  searchSteps: 40,
  paceScale: 10,
} as const;

interface Simulation {
  dryAt: number | null;
  segments: ForecastSegment[];
  resets: ForecastReset[];
  outages: ForecastOutage[];
}

interface Budget {
  id: string;
  left: number;
  resetsAt: number | null;
  start: number;
  startLeft: number;
  emptyAt: number | null;
}

export function resolveForecastAccount(
  id: string,
  label: string,
  usage: AccountUsage,
  spentUntil: number | null,
  now: number
): ForecastAccount | null {
  const weekly = usage.windows.find((window) => window.kind === 'weekly');
  if (!weekly) return null;
  const spent =
    spentUntil !== null && spentUntil > now && (weekly.resetsAt === null || spentUntil >= weekly.resetsAt);
  let left = spent ? 0 : Math.max(0, FORECAST_LIMITS.fullPercent - weekly.usedPercent);
  let resetsAt = weekly.resetsAt;
  while (resetsAt !== null && resetsAt <= now) {
    resetsAt += FORECAST_LIMITS.weekMs;
    left = FORECAST_LIMITS.fullPercent;
  }
  return { id, label, left, resetsAt };
}

export function listForecastAccounts(accounts: AccountSummary[], now: number): ForecastAccount[] {
  return accounts
    .filter((account) => !account.paused && account.signIn !== 'signed_out')
    .map((account) =>
      resolveForecastAccount(account.id, account.email ?? account.id, account.usage, account.spentUntil, now)
    )
    .filter((account) => account !== null);
}

function sumLeft(budgets: readonly { left: number }[]) {
  return budgets.reduce((total, budget) => total + budget.left, 0);
}

function byDeadline(a: { resetsAt: number | null }, b: { resetsAt: number | null }) {
  return (a.resetsAt ?? Number.POSITIVE_INFINITY) - (b.resetsAt ?? Number.POSITIVE_INFINITY);
}

function drain(budgets: Budget[], pace: number, at: number, next: number) {
  let cursor = at;
  for (const budget of [...budgets].sort(byDeadline)) {
    if (budget.left <= 0) continue;
    const emptiesAt = cursor + (budget.left / pace) * DAY_MS;
    if (emptiesAt >= next) {
      budget.left -= (pace * (next - cursor)) / DAY_MS;
      return next;
    }
    budget.left = 0;
    budget.emptyAt = emptiesAt;
    cursor = emptiesAt;
  }
  return cursor;
}

function closeSegment(budget: Budget, to: number): ForecastSegment {
  return { accountId: budget.id, from: budget.start, to, left: budget.startLeft, emptyAt: budget.emptyAt };
}

function simulate(accounts: readonly ForecastAccount[], pace: number, from: number, to: number): Simulation {
  const budgets: Budget[] = accounts.map((account) => ({
    id: account.id,
    left: account.left,
    resetsAt: account.resetsAt,
    start: from,
    startLeft: account.left,
    emptyAt: account.left > 0 ? null : from,
  }));
  const segments: ForecastSegment[] = [];
  const resets: ForecastReset[] = [];
  const outages: ForecastOutage[] = [];
  let at = from;
  while (at < to) {
    const deadlines = budgets.flatMap((budget) =>
      budget.resetsAt !== null && budget.resetsAt < to ? [budget.resetsAt] : []
    );
    const next = Math.min(to, ...deadlines);
    const cursor = drain(budgets, pace, at, next);
    if (cursor < next) outages.push({ from: cursor, to: next });
    const leftBefore = sumLeft(budgets);
    for (const budget of budgets) {
      if (budget.resetsAt !== next) continue;
      resets.push({ accountId: budget.id, at: next, leftBefore });
      segments.push(closeSegment(budget, next));
      budget.left = FORECAST_LIMITS.fullPercent;
      budget.resetsAt = next + FORECAST_LIMITS.weekMs;
      budget.start = next;
      budget.startLeft = FORECAST_LIMITS.fullPercent;
      budget.emptyAt = null;
    }
    at = next;
  }
  for (const budget of budgets) segments.push(closeSegment(budget, to));
  return { dryAt: outages[0]?.from ?? null, segments, resets, outages };
}

function resolveSafePace(accounts: readonly ForecastAccount[], from: number, to: number) {
  const days = (to - from) / DAY_MS;
  const refills = simulate(accounts, 0, from, to).resets.length;
  let low = 0;
  let high = (sumLeft(accounts) + refills * FORECAST_LIMITS.fullPercent) / days;
  for (let step = 0; step < FORECAST_LIMITS.searchSteps; step += 1) {
    const middle = (low + high) / 2;
    if (simulate(accounts, middle, from, to).dryAt === null) low = middle;
    else high = middle;
  }
  const nearest = Math.round(low * FORECAST_LIMITS.paceScale) / FORECAST_LIMITS.paceScale;
  if (nearest <= 0 || simulate(accounts, nearest, from, to).dryAt === null) return nearest;
  return (Math.round(low * FORECAST_LIMITS.paceScale) - 1) / FORECAST_LIMITS.paceScale;
}

function selectTightest(resets: ForecastReset[]) {
  let tightest: ForecastReset | null = null;
  for (const reset of resets) {
    if (tightest === null || reset.leftBefore < tightest.leftBefore) tightest = reset;
  }
  return tightest;
}

function byAccount(order: readonly ForecastAccount[]) {
  const rank = new Map(order.map((account, index) => [account.id, index]));
  return (a: ForecastSegment, b: ForecastSegment) =>
    (rank.get(a.accountId) ?? 0) - (rank.get(b.accountId) ?? 0) || a.from - b.from;
}

export function resolveUsageForecast(
  accounts: readonly ForecastAccount[],
  now: number,
  currentPace: number | null = null
): UsageForecast | null {
  if (accounts.length === 0) return null;
  const to = now + FORECAST_LIMITS.horizonMs;
  const ordered = [...accounts].sort(byDeadline);
  const safePace = resolveSafePace(ordered, now, to);
  const safe = simulate(ordered, safePace, now, to);
  const pace = currentPace ?? 0;
  const current = pace > 0 ? simulate(ordered, pace, now, to) : null;
  const faster = current !== null && pace > safePace;
  const timeline = faster ? current : safe;
  return {
    from: now,
    to,
    accounts: ordered,
    segments: [...timeline.segments].sort(byAccount(ordered)),
    outages: timeline.outages,
    timelinePace: faster ? pace : safePace,
    resets: safe.resets,
    safePace,
    tightest: selectTightest(safe.resets),
    currentPace,
    runsOutAt: current?.dryAt ?? null,
  };
}
