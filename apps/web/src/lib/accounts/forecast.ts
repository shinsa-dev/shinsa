import {
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  DAY_MS,
  FORECAST_LIMITS,
  type ForecastAccount,
  type ForecastOutage,
  type ForecastSegment,
  type ForecastTimeline,
  listForecastAccounts,
  resolveForecastAccount,
  resolveProviderLabel,
  resolveRecentUsage,
  resolveUsageForecast,
  type ShinsaState,
  type UsageForecast,
} from '@shinsa/core';
import { formatDaysAndHours } from '@/lib/format/time.ts';

export interface ProviderForecast {
  provider: string;
  title: string;
  forecast: UsageForecast;
}

export interface ForecastLane {
  account: ForecastAccount;
  segments: ForecastSegment[];
}

export interface ForecastDay {
  at: number;
  share: number;
}

export type ForecastPaceChoice = 'safe' | 'recent' | 'faster' | 'double';

export interface ForecastPaceOption {
  value: ForecastPaceChoice;
  label: string;
  hint?: string;
  pace: number;
}

const WHAT_IF_PACES = [
  { value: 'faster', times: 1.5, hint: 'One and a half times the safe pace' },
  { value: 'double', times: 2, hint: 'Twice the safe pace' },
] as const;

export const FORECAST_TITLE = 'Forecast';

export const APPLY_PACE_LABEL = 'Use as daily limit';

export const FORECAST_LEGEND = [
  { key: 'usable', label: 'Has usage' },
  { key: 'empty', label: 'Out of usage' },
  { key: 'outage', label: 'Every account out of usage' },
  { key: 'tightest', label: 'Tightest point' },
] as const;

const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' });

export function resolveRecentPace(state: ShinsaState, provider: string, now: number) {
  const recent = resolveRecentUsage(state, now, { provider });
  return recent.spends.length === 0 ? null : recent.percent;
}

function listProviderAccounts(snapshot: AccountsSnapshot, provider: string, now: number) {
  if (provider === CLAUDE_PROVIDER) return listForecastAccounts(snapshot.accounts, now);
  const login = snapshot.providers?.find((entry) => entry.provider === provider);
  if (!login?.usage || login.status === 'signed_out') return [];
  const account = resolveForecastAccount(provider, login.email ?? login.label, login.usage, null, now);
  return account ? [account] : [];
}

function listProviders(snapshot: AccountsSnapshot) {
  const others = (snapshot.providers ?? [])
    .map((login) => login.provider)
    .filter((provider) => provider !== CLAUDE_PROVIDER);
  return [CLAUDE_PROVIDER, ...others];
}

export function listProviderForecasts(
  snapshot: AccountsSnapshot | null,
  state: ShinsaState,
  now: number
): ProviderForecast[] {
  if (!snapshot) return [];
  return listProviders(snapshot).flatMap((provider) => {
    const accounts = listProviderAccounts(snapshot, provider, now);
    const forecast = resolveUsageForecast(accounts, now, resolveRecentPace(state, provider, now));
    return forecast ? [{ provider, title: resolveProviderLabel(provider), forecast }] : [];
  });
}

export function formatPace(percent: number) {
  return `${Number(percent.toFixed(1))}%`;
}

export function describeSafePace(forecast: UsageForecast) {
  if (forecast.safePace <= 0) return 'Every account is out of usage until the next reset.';
  return `Up to ${formatPace(forecast.safePace)} of a weekly limit a day keeps you going for the next 7 days.`;
}

function selectLabel(forecast: UsageForecast, accountId: string) {
  return forecast.accounts.find((account) => account.id === accountId)?.label ?? accountId;
}

export function describeTightest(forecast: UsageForecast, now: number) {
  const tightest = forecast.tightest;
  if (!tightest) return null;
  const label = selectLabel(forecast, tightest.accountId);
  return `Tightest point at the safe pace: ${formatPace(tightest.leftBefore)} left just before ${label} resets in ${formatDaysAndHours(tightest.at - now)}.`;
}

export function describeRecentPace(forecast: UsageForecast, now: number) {
  if (forecast.currentPace === null) return 'No measured usage in the last 24 hours.';
  const pace = `In the last 24 hours you used ${formatPace(forecast.currentPace)}.`;
  if (forecast.runsOutAt === null) return `${pace} At that pace your accounts last the week.`;
  return `${pace} At that pace every account runs out in ${formatDaysAndHours(forecast.runsOutAt - now)}.`;
}

export function isPaceApplied(forecast: UsageForecast, dailyUsageLimit: number | null | undefined) {
  return dailyUsageLimit === forecast.safePace;
}

export function listForecastLanes(forecast: UsageForecast, timeline: ForecastTimeline): ForecastLane[] {
  return forecast.accounts.map((account) => ({
    account,
    segments: timeline.segments.filter((segment) => segment.accountId === account.id),
  }));
}

export function resolveForecastShare(forecast: UsageForecast, at: number) {
  return Math.min(1, Math.max(0, (at - forecast.from) / (forecast.to - forecast.from)));
}

export function listForecastDays(forecast: UsageForecast): ForecastDay[] {
  const days: ForecastDay[] = [];
  const midnight = new Date(forecast.from).setHours(24, 0, 0, 0);
  for (let at = midnight; at < forecast.to; at = new Date(at + DAY_MS).setHours(0, 0, 0, 0)) {
    days.push({ at, share: resolveForecastShare(forecast, at) });
  }
  return days;
}

export function formatForecastDay(at: number) {
  return WEEKDAY.format(at);
}

function roundPace(percent: number) {
  return Math.round(percent * 10) / 10;
}

function resolveSafeOption(forecast: UsageForecast): ForecastPaceOption {
  return { value: 'safe', label: `Safe pace ${formatPace(forecast.safePace)}`, pace: forecast.safePace };
}

export function listForecastPaces(forecast: UsageForecast): ForecastPaceOption[] {
  const safe = resolveSafeOption(forecast);
  const recent: ForecastPaceOption[] =
    forecast.currentPace !== null && forecast.currentPace > 0
      ? [
          {
            value: 'recent',
            label: `Last 24 hours ${formatPace(forecast.currentPace)}`,
            pace: forecast.currentPace,
          },
        ]
      : [];
  const whatIf: ForecastPaceOption[] =
    forecast.safePace > 0
      ? WHAT_IF_PACES.map((option) => {
          const pace = roundPace(forecast.safePace * option.times);
          return { value: option.value, label: formatPace(pace), hint: option.hint, pace };
        })
      : [];
  return [safe, ...recent, ...whatIf];
}

export function resolveDefaultPace(forecast: UsageForecast): ForecastPaceChoice {
  return forecast.currentPace !== null && forecast.currentPace > forecast.safePace ? 'recent' : 'safe';
}

export function selectForecastPace(forecast: UsageForecast, choice: ForecastPaceChoice) {
  return listForecastPaces(forecast).find((option) => option.value === choice) ?? resolveSafeOption(forecast);
}

export function describeOutages(timeline: ForecastTimeline, now: number) {
  const first = timeline.outages[0];
  if (!first) return null;
  const total = timeline.outages.reduce((sum, outage) => sum + outage.to - outage.from, 0);
  const start = first.from <= now ? 'now' : `in ${formatDaysAndHours(first.from - now)}`;
  return `At ${formatPace(timeline.pace)} a day every account is out of usage for ${formatDaysAndHours(total)} in all, starting ${start}.`;
}

export function listOutageSpans(forecast: UsageForecast, outages: readonly ForecastOutage[]) {
  return outages.map((outage) => {
    const start = resolveForecastShare(forecast, outage.from);
    return { at: outage.from, outage, start, width: resolveForecastShare(forecast, outage.to) - start };
  });
}

export function resolveUsableShare(segment: ForecastSegment) {
  const end = segment.emptyAt ?? segment.to;
  return segment.to === segment.from ? 0 : Math.max(0, (end - segment.from) / (segment.to - segment.from));
}

function resolveSegmentEnd(forecast: UsageForecast, segment: ForecastSegment) {
  if (segment.to < forecast.to) return segment.to;
  const resetsAt = forecast.accounts.find((account) => account.id === segment.accountId)?.resetsAt ?? null;
  if (resetsAt === null) return null;
  const weeks = Math.max(0, Math.floor((segment.from - resetsAt) / FORECAST_LIMITS.weekMs) + 1);
  return resetsAt + weeks * FORECAST_LIMITS.weekMs;
}

export function describeSegment(forecast: UsageForecast, segment: ForecastSegment, now: number) {
  const end = resolveSegmentEnd(forecast, segment);
  const outFor = (from: number) =>
    end === null ? 'with no known reset' : `for ${formatDaysAndHours(end - from)}`;
  if (segment.emptyAt !== null && segment.emptyAt <= Math.max(segment.from, now)) {
    return `Out of usage ${outFor(Math.max(segment.from, now))}.`;
  }
  const left = formatPace(segment.left);
  const head =
    segment.from <= now ? `${left} left` : `Resets to ${left} in ${formatDaysAndHours(segment.from - now)}`;
  if (segment.emptyAt !== null) {
    return `${head}. Runs out in ${formatDaysAndHours(segment.emptyAt - now)}, then out ${outFor(segment.emptyAt)}.`;
  }
  if (end === null || segment.from > now) return `${head}.`;
  return `${head}. Resets in ${formatDaysAndHours(end - now)}.`;
}

export function describeOutage(outage: ForecastOutage, now: number) {
  const start = outage.from <= now ? 'from now' : `starting in ${formatDaysAndHours(outage.from - now)}`;
  return `All accounts out for ${formatDaysAndHours(outage.to - outage.from)}, ${start}.`;
}
