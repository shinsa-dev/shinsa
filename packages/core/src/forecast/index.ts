import { Option } from 'effect';
import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import { DAY_MS } from '../domain/time.ts';
import type { RecordedPace } from '../domain/types.ts';
import type {
  AccountSummary,
  AccountsSnapshot,
  AccountUsage,
  UsageResetGrant,
} from '../protocol/accounts.ts';
import type {
  ForecastAccount,
  ForecastOutage,
  ForecastReset,
  ForecastSegment,
  ForecastTimeline,
  UsageForecast,
} from './schema.ts';

export type {
  ForecastAccount,
  ForecastOutage,
  ForecastReset,
  ForecastSegment,
  ForecastTimeline,
  UsageForecast,
} from './schema.ts';

export const FORECAST_LIMITS = {
  horizonMs: 7 * DAY_MS,
  weekMs: 7 * DAY_MS,
  fullPercent: 100,
  searchSteps: 40,
  paceScale: 10,
  weeklyClear: 'seven_day',
  paceStep: 1,
} as const;

export interface ForecastOptions {
  grants?: boolean;
}

export function resolveGrantRefill(grant: UsageResetGrant) {
  if (grant.clears.includes(FORECAST_LIMITS.weeklyClear)) return FORECAST_LIMITS.fullPercent;
  if (!grant.givesBackWeekly) return 0;
  return Math.min(FORECAST_LIMITS.fullPercent, Math.max(0, grant.weeklyShare ?? 0));
}

function listUsableGrants(usage: AccountUsage, now: number) {
  return (usage.resetGrants ?? []).filter(
    (grant) =>
      grant.usableNow &&
      grant.left > 0 &&
      resolveGrantRefill(grant) > 0 &&
      (grant.endsAt === null || grant.endsAt > now)
  );
}

function listGrantAccounts(id: string, label: string, usage: AccountUsage, now: number): ForecastAccount[] {
  return listUsableGrants(usage, now).map((grant) => ({
    id: `${id}:${grant.id}`,
    label,
    left: grant.left * resolveGrantRefill(grant),
    resetsAt: grant.endsAt,
    refills: false,
  }));
}

function listAccountBudgets(
  id: string,
  label: string,
  usage: AccountUsage,
  spentUntil: number | null,
  now: number,
  options: ForecastOptions
) {
  const weekly = resolveForecastAccount(id, label, usage, spentUntil, now);
  if (Option.isNone(weekly)) return [];
  return options.grants ? [weekly.value, ...listGrantAccounts(id, label, usage, now)] : [weekly.value];
}

interface Simulation {
  dryAt: number | null;
  segments: ForecastSegment[];
  resets: ForecastReset[];
  outages: ForecastOutage[];
}

interface Budget {
  id: string;
  refills: boolean;
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
): Option.Option<ForecastAccount> {
  const weekly = usage.windows.find((window) => window.kind === 'weekly');
  if (!weekly) return Option.none();
  const spent =
    spentUntil !== null && spentUntil > now && (weekly.resetsAt === null || spentUntil >= weekly.resetsAt);
  let left = spent ? 0 : Math.max(0, FORECAST_LIMITS.fullPercent - weekly.usedPercent);
  let resetsAt = weekly.resetsAt;
  while (resetsAt !== null && resetsAt <= now) {
    resetsAt += FORECAST_LIMITS.weekMs;
    left = FORECAST_LIMITS.fullPercent;
  }
  return Option.some({ id, label, left, resetsAt });
}

export function listForecastAccounts(
  accounts: AccountSummary[],
  now: number,
  options: ForecastOptions = {}
): ForecastAccount[] {
  return accounts
    .filter((account) => !account.paused && account.signIn !== 'signed_out')
    .flatMap((account) =>
      listAccountBudgets(
        account.id,
        account.email ?? account.id,
        account.usage,
        account.spentUntil,
        now,
        options
      )
    );
}

export function listForecastProviders(snapshot: AccountsSnapshot) {
  const others = (snapshot.providers ?? [])
    .map((login) => login.provider)
    .filter((provider) => provider !== CLAUDE_PROVIDER);
  return [CLAUDE_PROVIDER, ...others];
}

export function listProviderForecastAccounts(
  snapshot: AccountsSnapshot,
  provider: string,
  now: number,
  options: ForecastOptions = {}
): ForecastAccount[] {
  if (provider === CLAUDE_PROVIDER) return listForecastAccounts(snapshot.accounts, now, options);
  const login = snapshot.providers?.find((entry) => entry.provider === provider);
  if (!login?.usage || login.status === 'signed_out') return [];
  return listAccountBudgets(provider, login.email ?? login.label, login.usage, null, now, options);
}

export function resolveRecordablePace(pace: number | null) {
  return Option.map(
    Option.filter(Option.fromNullOr(pace), (value) => Number.isFinite(value)),
    (value) => Math.max(0, value)
  );
}

export function isPaceMoved(known: number | null, pace: number | null) {
  const next = resolveRecordablePace(pace);
  if (Option.isNone(next)) return known !== null;
  if (known === null) return true;
  return Math.abs(known - next.value) >= FORECAST_LIMITS.paceStep;
}

export function isProviderPaceMoved(known: RecordedPace | undefined, next: Omit<ProviderPace, 'provider'>) {
  if (isPaceMoved(known?.pace ?? null, next.pace)) return true;
  if (!known || Option.isNone(resolveRecordablePace(next.pace))) return false;
  return isPaceMoved(known.resetPace, next.resetPace ?? next.pace) || known.resetEndsAt !== next.resetEndsAt;
}

export interface ProviderPace {
  provider: string;
  pace: number | null;
  resetPace: number | null;
  resetEndsAt: number | null;
}

function resolveProviderSafePace(accounts: readonly ForecastAccount[], now: number) {
  return Option.getOrNull(Option.map(resolveUsageForecast(accounts, now), (forecast) => forecast.safePace));
}

function resolveResetEndsAt(accounts: readonly ForecastAccount[]) {
  const ends = accounts.flatMap((account) =>
    account.refills === false && account.resetsAt !== null ? [account.resetsAt] : []
  );
  return ends.length === 0 ? null : Math.min(...ends);
}

export function listProviderPaces(snapshot: AccountsSnapshot, now: number): ProviderPace[] {
  return listForecastProviders(snapshot).map((provider) => {
    const plain = listProviderForecastAccounts(snapshot, provider, now);
    const withResets = listProviderForecastAccounts(snapshot, provider, now, { grants: true });
    const pace = resolveProviderSafePace(plain, now);
    const counted = withResets.length > plain.length;
    return {
      provider,
      pace,
      resetPace: counted ? resolveProviderSafePace(withResets, now) : pace,
      resetEndsAt: resolveResetEndsAt(withResets),
    };
  });
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
    refills: account.refills ?? true,
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
      if (!budget.refills) {
        budget.left = 0;
        budget.resetsAt = null;
        continue;
      }
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

export function resolveForecastTimeline(forecast: UsageForecast, pace: number): ForecastTimeline {
  const timeline = simulate(forecast.accounts, pace, forecast.from, forecast.to);
  return {
    pace,
    segments: [...timeline.segments].sort(byAccount(forecast.accounts)),
    outages: timeline.outages,
  };
}

export function resolveUsageForecast(
  accounts: readonly ForecastAccount[],
  now: number,
  currentPace: number | null = null
): Option.Option<UsageForecast> {
  if (accounts.length === 0) return Option.none();
  const to = now + FORECAST_LIMITS.horizonMs;
  const ordered = [...accounts].sort(byDeadline);
  const safePace = resolveSafePace(ordered, now, to);
  const safe = simulate(ordered, safePace, now, to);
  const pace = currentPace ?? 0;
  const current = pace > 0 ? simulate(ordered, pace, now, to) : null;
  return Option.some({
    from: now,
    to,
    accounts: ordered,
    resets: safe.resets,
    safePace,
    tightest: selectTightest(safe.resets),
    currentPace,
    runsOutAt: current?.dryAt ?? null,
  });
}
