import { DAY_MS } from '../domain/time.ts';
import type { AccountSummary, AccountUsage } from '../protocol/accounts.ts';
import type {
  ForecastAccount,
  ForecastPoint,
  ForecastReset,
  ForecastSegment,
  UsageForecast,
} from './schema.ts';

export type {
  ForecastAccount,
  ForecastPoint,
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
  points: ForecastPoint[];
  resets: ForecastReset[];
}

interface Budget {
  id: string;
  left: number;
  resetsAt: number | null;
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
  const spent = spentUntil !== null && spentUntil > now;
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

function byDeadline(a: Budget, b: Budget) {
  return (a.resetsAt ?? Number.POSITIVE_INFINITY) - (b.resetsAt ?? Number.POSITIVE_INFINITY);
}

function draw(budgets: Budget[], demand: number) {
  let owed = demand;
  for (const budget of [...budgets].sort(byDeadline)) {
    const taken = Math.min(budget.left, owed);
    budget.left -= taken;
    owed -= taken;
  }
}

function simulate(accounts: readonly ForecastAccount[], pace: number, from: number, to: number): Simulation {
  const budgets = accounts.map((account) => ({
    id: account.id,
    left: account.left,
    resetsAt: account.resetsAt,
  }));
  const points: ForecastPoint[] = [{ at: from, left: sumLeft(budgets) }];
  const resets: ForecastReset[] = [];
  let at = from;
  while (at < to) {
    const deadlines = budgets
      .map((budget) => budget.resetsAt)
      .filter((reset) => reset !== null && reset < to);
    const next = Math.min(to, ...(deadlines as number[]));
    const demand = (pace * (next - at)) / DAY_MS;
    const available = sumLeft(budgets);
    if (available < demand) {
      const dryAt = at + (available / pace) * DAY_MS;
      points.push({ at: dryAt, left: 0 });
      return { dryAt, points, resets };
    }
    draw(budgets, demand);
    const leftBefore = sumLeft(budgets);
    points.push({ at: next, left: leftBefore });
    for (const budget of budgets) {
      if (budget.resetsAt !== next) continue;
      resets.push({ accountId: budget.id, at: next, leftBefore });
      budget.left = FORECAST_LIMITS.fullPercent;
      budget.resetsAt = next + FORECAST_LIMITS.weekMs;
    }
    if (next < to) points.push({ at: next, left: sumLeft(budgets) });
    at = next;
  }
  return { dryAt: null, points, resets };
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
  if (simulate(accounts, nearest, from, to).dryAt === null) return nearest;
  return (Math.round(low * FORECAST_LIMITS.paceScale) - 1) / FORECAST_LIMITS.paceScale;
}

function listSegments(accounts: readonly ForecastAccount[], from: number, to: number) {
  const segments: ForecastSegment[] = [];
  for (const account of accounts) {
    let start = from;
    let left = account.left;
    let end = account.resetsAt ?? to;
    while (start < to) {
      segments.push({ accountId: account.id, from: start, to: Math.min(end, to), left });
      start = end;
      end += FORECAST_LIMITS.weekMs;
      left = FORECAST_LIMITS.fullPercent;
    }
  }
  return segments;
}

function selectTightest(resets: ForecastReset[]) {
  let tightest: ForecastReset | null = null;
  for (const reset of resets) {
    if (tightest === null || reset.leftBefore < tightest.leftBefore) tightest = reset;
  }
  return tightest;
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
  const runsOutAt =
    currentPace === null || currentPace <= 0 ? null : simulate(ordered, currentPace, now, to).dryAt;
  return {
    from: now,
    to,
    accounts: ordered,
    segments: listSegments(ordered, now, to),
    resets: safe.resets,
    points: safe.points,
    safePace,
    tightest: selectTightest(safe.resets),
    currentPace,
    runsOutAt,
  };
}
