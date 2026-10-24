import {
  type AccountSummary,
  type AccountsSnapshot,
  type AccountUsage,
  CLAUDE_PROVIDER,
  listRelevantWindows,
  type ProviderLogin,
  resolveAgentModel,
  resolveAgentProvider,
  resolveCandidateSpentUntil,
  resolveSpentUntil,
  type Settings,
  selectNextAccount,
  type UsageWindow,
} from '@shinsa/core';
import { resolveAccountLabel } from '@/lib/accounts/account.ts';
import { formatMoment, formatSince, formatUntil } from '@/lib/format/time.ts';
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
  label: string;
  account: AccountSummary | null;
  row: UsageRow | null;
}

export interface ProviderGlance {
  login: ProviderLogin;
  label: string;
  usage: AccountUsage;
  row: UsageRow | null;
  status: AccountStatus | null;
}

export interface AccountStatus {
  label: string;
  tone: Tone;
  until: number | null;
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
  return resolveAgentModel(settings, 'builder', CLAUDE_PROVIDER);
}

function selectHighestWindow(usage: AccountUsage, model: string | null) {
  const [highest] = listRelevantWindows(usage, model)
    .slice()
    .sort((a, b) => b.usedPercent - a.usedPercent);
  return highest ? createUsageRow(highest) : null;
}

export function selectHighestRow(account: AccountSummary, model: string | null) {
  return selectHighestWindow(account.usage, model);
}

export function describeProviderAccount(login: ProviderLogin) {
  return login.email ? `${login.label} · ${login.email}` : login.label;
}

function resolveProviderStatus(login: ProviderLogin, usage: AccountUsage, now: number): AccountStatus | null {
  if (login.status === 'signed_out') return { label: 'Needs sign-in', tone: 'orange', until: null };
  const until = resolveSpentUntil(usage, null, now);
  return until === null ? null : { label: 'Out of usage', tone: 'red', until };
}

export function listProviderGlances(snapshot: AccountsSnapshot | null, now: number): ProviderGlance[] {
  return (snapshot?.providers ?? []).flatMap((login) => {
    const usage = login.usage;
    if (!usage) return [];
    return [
      {
        login,
        label: describeProviderAccount(login),
        usage,
        row: selectHighestWindow(usage, null),
        status: resolveProviderStatus(login, usage, now),
      },
    ];
  });
}

function createProviderGlance(glance: ProviderGlance): UsageGlance {
  return { provider: glance.login.provider, label: glance.label, account: null, row: glance.row };
}

export function resolveUsageGlance(
  snapshot: AccountsSnapshot | null,
  settings: Settings,
  now: number
): UsageGlance | null {
  if (!snapshot) return null;
  const providers = listProviderGlances(snapshot, now);
  const preferred = resolveAgentProvider(settings, 'builder');
  const own = providers.find((glance) => glance.login.provider === preferred);
  if (own) return createProviderGlance(own);
  const model = resolveUsageModel(settings);
  const account = selectNextAccount(snapshot.accounts, settings, model, now);
  if (account) {
    return {
      provider: CLAUDE_PROVIDER,
      label: resolveAccountLabel(account),
      account,
      row: selectHighestRow(account, model),
    };
  }
  const [first] = providers;
  return first ? createProviderGlance(first) : null;
}

export function describeGlance(glance: UsageGlance) {
  return `The next run uses ${glance.label}`;
}

export function describeUsageDetail(account: { usage: AccountUsage }) {
  return account.usage.detail ?? 'No usage reported yet.';
}

export function describeUsageChecked(checkedAt: number, now: number) {
  return formatSince('Updated', checkedAt, now);
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
  return status.until === null ? status.label : `${status.label} until ${formatMoment(status.until, now)}`;
}
