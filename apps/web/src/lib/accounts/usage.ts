import {
  type AccountSummary,
  type AccountsSnapshot,
  type AccountUsage,
  CLAUDE_PROVIDER,
  listRelevantWindows,
  MINUTE_MS,
  type ProviderLogin,
  resolveAgentModel,
  resolveAgentProvider,
  resolveCandidateSpentUntil,
  resolvePlanLabel,
  resolveSpentUntil,
  type Settings,
  selectNextAccount,
  type UsageWindow,
} from '@shinsa/core';
import { type AccountProvider, resolveAccountProvider } from '@/lib/accounts/account.ts';
import { formatDuration, formatMoment, formatSince, formatUntil, isSameDay } from '@/lib/format/time.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';

const USAGE_WARNING = 75;

const USAGE_CRITICAL = 90;

export interface UsageRow {
  id: string;
  label: string;
  percent: number;
  tone: Tone;
  resetsAt: number | null;
}

export interface UsageGlance {
  provider: string;
  account: AccountSummary | null;
  row: UsageRow | null;
}

export interface ProviderGlance {
  login: ProviderLogin;
  name: AccountProvider;
  usage: AccountUsage;
  row: UsageRow | null;
  status: AccountStatus | null;
}

export interface AccountStatus {
  label: string;
  tone: Tone;
  until: number | null;
}

export interface UsageAccountHeader {
  name: AccountProvider;
  detail: string | null;
  isDefault: boolean;
  status: AccountStatus | null;
  checkedAt: number | null;
  retryAt: number | null;
  reason: string | null;
}

export function resolveUsageTone(percent: number): Tone {
  if (percent >= USAGE_CRITICAL) return 'red';
  if (percent >= USAGE_WARNING) return 'amber';
  return 'neutral';
}

export function resolveUsageText(percent: number) {
  const tone = resolveUsageTone(percent);
  return tone === 'neutral' ? 'text-fg-3' : TONE_TEXT[tone];
}

function clampPercent(percent: number) {
  return Math.round(Math.min(100, Math.max(0, percent)));
}

function createUsageRow(window: UsageWindow): UsageRow {
  const percent = clampPercent(window.usedPercent);
  return {
    id: window.id,
    label: window.label,
    percent,
    tone: resolveUsageTone(percent),
    resetsAt: window.resetsAt,
  };
}

export function listUsageRows(account: { usage: AccountUsage }) {
  return account.usage.windows.map(createUsageRow);
}

export function resolveUsageModel(settings: Settings) {
  return resolveAgentModel(settings, 'agent', CLAUDE_PROVIDER);
}

function compareGlanceWindows(a: UsageWindow, b: UsageWindow) {
  const fuller = clampPercent(b.usedPercent) - clampPercent(a.usedPercent);
  if (fuller !== 0) return fuller;
  return Number(b.kind === 'session') - Number(a.kind === 'session');
}

function selectGlanceWindow(usage: AccountUsage, model: string | null) {
  const [binding] = listRelevantWindows(usage, model).sort(compareGlanceWindows);
  return binding ? createUsageRow(binding) : null;
}

export function selectGlanceRow(account: AccountSummary, model: string | null) {
  return selectGlanceWindow(account.usage, model);
}

const LOGIN_STATUS: Partial<Record<ProviderLogin['status'], AccountStatus>> = {
  signed_out: { label: 'Needs sign-in', tone: 'orange', until: null },
  outdated: { label: 'Update needed', tone: 'orange', until: null },
};

export function resolveProviderStatus(login: ProviderLogin, now: number): AccountStatus | null {
  const status = LOGIN_STATUS[login.status];
  if (status) return status;
  const until = login.usage ? resolveSpentUntil(login.usage, null, now) : null;
  return until === null ? null : { label: 'Out of usage', tone: 'red', until };
}

export function listProviderGlances(snapshot: AccountsSnapshot | null, now: number): ProviderGlance[] {
  return (snapshot?.providers ?? []).flatMap((login) => {
    const usage = login.usage;
    if (!usage) return [];
    return [
      {
        login,
        name: resolveAccountProvider(login.provider, login.email ?? null),
        usage,
        row: selectGlanceWindow(usage, null),
        status: resolveProviderStatus(login, now),
      },
    ];
  });
}

function createProviderGlance(glance: ProviderGlance): UsageGlance {
  return { provider: glance.login.provider, account: null, row: glance.row };
}

export function resolveUsageGlance(
  snapshot: AccountsSnapshot | null,
  settings: Settings,
  now: number
): UsageGlance | null {
  if (!snapshot) return null;
  const providers = listProviderGlances(snapshot, now);
  const preferred = resolveAgentProvider(settings, 'agent');
  const own = providers.find((glance) => glance.login.provider === preferred);
  if (own) return createProviderGlance(own);
  const model = resolveUsageModel(settings);
  const account = selectNextAccount(snapshot.accounts, settings, model, now);
  if (account) {
    return {
      provider: CLAUDE_PROVIDER,
      account,
      row: selectGlanceRow(account, model),
    };
  }
  const [first] = providers;
  return first ? createProviderGlance(first) : null;
}

export function isNextAccount(glance: UsageGlance, account: AccountSummary) {
  return glance.account?.id === account.id;
}

export function isNextProvider(glance: UsageGlance, login: ProviderLogin) {
  return glance.account === null && glance.provider === login.provider;
}

export function describeUsageDetail(account: { usage: AccountUsage }) {
  return account.usage.detail ?? 'No usage reported yet.';
}

export function describeUsageChecked(checkedAt: number, retryAt: number | null, now: number) {
  const updated = formatSince('Updated', checkedAt, now);
  return retryAt !== null && retryAt > now
    ? `${updated} · ${formatUntil('next read', retryAt, now)}`
    : updated;
}

export function describeResetsIn(resetsAt: number, now: number) {
  return resetsAt <= now ? 'Resets now' : formatUntil('Resets', resetsAt, now);
}

export function resolveAccountStatus(
  account: AccountSummary,
  model: string | null,
  now: number
): AccountStatus | null {
  if (account.signIn === 'signed_out') return { label: 'Needs sign-in', tone: 'orange', until: null };
  if (account.paused) return { label: 'Paused', tone: 'neutral', until: null };
  const until = resolveCandidateSpentUntil(account, model, now);
  return until === null ? null : { label: 'Out of usage', tone: 'red', until };
}

export function describeAccountStatus(status: AccountStatus, now: number) {
  const { until } = status;
  if (until === null) return status.label;
  if (until > now && isSameDay(until, now)) {
    return `${status.label}, resets in ${formatDuration(Math.max(MINUTE_MS, until - now))}`;
  }
  return `${status.label} until ${formatMoment(until, now)}`;
}

export function resolveAccountHeader(
  account: AccountSummary,
  model: string | null,
  now: number
): UsageAccountHeader {
  return {
    name: resolveAccountProvider(CLAUDE_PROVIDER, account.email),
    detail: resolvePlanLabel(account.plan),
    isDefault: account.isDefault,
    status: resolveAccountStatus(account, model, now),
    checkedAt: account.usage.checkedAt,
    retryAt: account.usage.retryAt ?? null,
    reason: account.usage.detail,
  };
}
