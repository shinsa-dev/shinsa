import {
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  DAY_MS,
  type ForecastAccount,
  type ForecastSegment,
  listForecastAccounts,
  resolveForecastAccount,
  resolveProviderLabel,
  resolveRecentUsage,
  resolveUsageForecast,
  type ShinsaState,
  type UsageForecast,
} from '@shinsa/core';
import { formatTurnaround } from '@/lib/format/time.ts';

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

export const FORECAST_TITLE = 'Forecast';

export const APPLY_PACE_LABEL = 'Use as daily limit';

export const POOL_LABEL = 'At this pace';

export const FORECAST_LEGEND = [
  { key: 'left', label: 'Left on the account' },
  { key: 'used', label: 'Already used' },
  { key: 'pool', label: 'Left across accounts at this pace' },
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
  const after = forecast.resets.find((reset) => reset.at > tightest.at);
  const then = after ? `, and the next one is ${formatTurnaround(after.at - tightest.at)} later` : '';
  return `Tightest point: at ${formatPace(forecast.safePace)} a day you have ${formatPace(tightest.leftBefore)} left across accounts just before ${label} resets in ${formatTurnaround(tightest.at - now)}${then}.`;
}

export function describeRecentPace(forecast: UsageForecast, now: number) {
  if (forecast.currentPace === null) return 'No measured usage in the last 24 hours.';
  const pace = `In the last 24 hours you used ${formatPace(forecast.currentPace)}.`;
  if (forecast.runsOutAt === null) return `${pace} At that pace your accounts last the week.`;
  return `${pace} At that pace every account runs out in ${formatTurnaround(forecast.runsOutAt - now)}.`;
}

export function isPaceApplied(forecast: UsageForecast, dailyUsageLimit: number | null | undefined) {
  return dailyUsageLimit === forecast.safePace;
}

export function listForecastLanes(forecast: UsageForecast): ForecastLane[] {
  return forecast.accounts.map((account) => ({
    account,
    segments: forecast.segments.filter((segment) => segment.accountId === account.id),
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

export function describeSegment(forecast: UsageForecast, segment: ForecastSegment, now: number) {
  const label = selectLabel(forecast, segment.accountId);
  const left = formatPace(segment.left);
  const until = segment.to < forecast.to ? ` until it resets in ${formatTurnaround(segment.to - now)}` : '';
  if (segment.from <= now) return `${label} has ${left} left${until}.`;
  return `${label} resets to ${left} in ${formatTurnaround(segment.from - now)}.`;
}

function resolveCoordinate(value: number) {
  return Number(value.toFixed(2));
}

export function resolveForecastPaths(forecast: UsageForecast, width: number, height: number) {
  const top = Math.max(0, ...forecast.points.map((point) => point.left));
  const first = forecast.points[0];
  const last = forecast.points.at(-1);
  if (!first || !last || top <= 0) return null;
  const x = (at: number) => resolveCoordinate(resolveForecastShare(forecast, at) * width);
  const y = (left: number) => resolveCoordinate(height - (left / top) * height);
  const line = `M ${forecast.points.map((point) => `${x(point.at)} ${y(point.left)}`).join(' L ')}`;
  return { line, area: `${line} L ${x(last.at)} ${height} L ${x(first.at)} ${height} Z` };
}
