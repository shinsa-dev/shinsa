import {
  type AccountSummary,
  type AccountsSnapshot,
  type AccountUsage,
  CLAUDE_PROVIDER,
  DAY_MS,
  describeCount,
  isResetEnding,
  listRelevantWindows,
  MINUTE_MS,
  type ProviderLogin,
  resolveAgentModel,
  resolveAgentProvider,
  resolveCandidateSpentUntil,
  selectCandidateSpentModel,
  resolveModelFamilyLabel,
  resolvePlanLabel,
  resolveSpentUntil,
  type Settings,
  selectNextAccount,
  type UsageMoney,
  type UsageResetGrant,
  type UsageWindow,
} from '@shinsa/core';
import { Option } from 'effect';
import { type AccountProvider, resolveAccountProvider } from '@/lib/accounts/account.ts';
import { formatDuration, formatMoment, formatSince, formatUntil, isSameDay } from '@/lib/format/time.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';

const USAGE_WARNING = 75;

const USAGE_CRITICAL = 90;

const CURRENCY_CODE = /^[A-Z]{3}$/;

const LIST_FORMAT = new Intl.ListFormat('en-US', { type: 'conjunction' });

const USAGE_EXTRA_LABEL = {
  extraUsage: 'Extra usage',
  on: 'On',
  off: 'Off',
  noLimit: 'On, no monthly limit',
  credit: 'Credit left',
  reset: 'Usage reset',
  resets: 'Usage resets',
  weekly: 'Weekly',
  fable: 'Fable',
  notUsable: 'Not usable yet',
};

const FULL_WEEKLY = 'full weekly';

const CLEARED_LIMITS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'weekly',
  seven_day_overage_included: 'Fable weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
};

export interface UsageResetLine {
  id: string;
  label: string;
  value: string;
  detail: string | null;
  ending: boolean;
}

export interface UsageNotePart {
  id: string;
  label: string;
  count: number;
  ending: boolean;
  lines: UsageResetLine[];
}

export interface UsageNoteRow {
  id: string;
  label: string;
  value: string;
  detail: string | null;
  ending: boolean;
  parts: UsageNotePart[];
}

export interface UsageResetsNote {
  text: string;
  ending: boolean;
}

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
  if (!login.usage) return null;
  return Option.getOrNull(
    Option.map(resolveSpentUntil(login.usage, null, now), (until) => ({
      label: 'Out of usage',
      tone: 'red' as const,
      until,
    }))
  );
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
  const account = Option.getOrNull(selectNextAccount(snapshot.accounts, settings, model, now));
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

function describeSpentLabel(account: AccountSummary, model: string | null, now: number) {
  return Option.match(selectCandidateSpentModel(account, model, now), {
    onNone: () => 'Out of usage',
    onSome: (spent) => `Out of ${resolveModelFamilyLabel(spent)} usage`,
  });
}

export function resolveAccountStatus(
  account: AccountSummary,
  model: string | null,
  now: number
): AccountStatus | null {
  if (account.signIn === 'signed_out') return { label: 'Needs sign-in', tone: 'orange', until: null };
  if (account.paused) return { label: 'Paused', tone: 'neutral', until: null };
  return Option.getOrNull(
    Option.map(resolveCandidateSpentUntil(account, model, now), (until) => ({
      label: describeSpentLabel(account, model, now),
      tone: 'red' as const,
      until,
    }))
  );
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
    detail: Option.getOrNull(resolvePlanLabel(account.plan)),
    isDefault: account.isDefault,
    status: resolveAccountStatus(account, model, now),
    checkedAt: account.usage.checkedAt,
    retryAt: account.usage.retryAt ?? null,
    reason: account.usage.detail,
  };
}

export function hasWholeCredit(credit: UsageMoney) {
  return credit.minor >= 10 ** credit.exponent;
}

export function formatUsageMoney(money: UsageMoney) {
  const amount = money.minor / 10 ** money.exponent;
  if (!CURRENCY_CODE.test(money.currency)) return `${amount.toFixed(money.exponent)} ${money.currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: money.exponent,
    maximumFractionDigits: money.exponent,
  }).format(amount);
}

function listClearedLimits(clears: string[]) {
  const limits = clears.flatMap((id) => (CLEARED_LIMITS[id] ? [CLEARED_LIMITS[id]] : []));
  if (!clears.includes('seven_day') || !clears.includes('seven_day_overage_included')) return limits;
  const weekly = [CLEARED_LIMITS.seven_day, CLEARED_LIMITS.seven_day_overage_included];
  return [...limits.filter((limit) => !weekly.includes(limit)), FULL_WEEKLY];
}

function describeCleared(clears: string[]) {
  const limits = listClearedLimits(clears);
  if (limits.length === 0) return null;
  return `Clears ${LIST_FORMAT.format(limits)}`;
}

function isGrantEnding(grant: UsageResetGrant, now: number) {
  return grant.usableNow && grant.left > 0 && isResetEnding(grant.endsAt, now);
}

export function describeEndsIn(endsAt: number, now: number) {
  const days = Math.floor((endsAt - now) / DAY_MS);
  if (days >= 1) return `in ${describeCount(days, 'day')}`;
  return `in ${formatDuration(Math.max(MINUTE_MS, endsAt - now))}`;
}

function describeGrantDetail(grant: UsageResetGrant, now: number) {
  const reach = grant.usableNow ? describeCleared(grant.clears) : USAGE_EXTRA_LABEL.notUsable;
  if (grant.endsAt === null) return reach;
  const ends = isGrantEnding(grant, now)
    ? describeEndsIn(grant.endsAt, now)
    : formatMoment(grant.endsAt, now);
  return reach === null ? `Ends ${ends}` : `${reach} · ends ${ends}`;
}

function resolveGrantKind(grant: UsageResetGrant) {
  if (grant.clears.includes('seven_day')) return USAGE_EXTRA_LABEL.weekly;
  if (grant.clears.includes('seven_day_overage_included')) return USAGE_EXTRA_LABEL.fable;
  return grant.label ?? USAGE_EXTRA_LABEL.reset;
}

const KIND_ORDER = [USAGE_EXTRA_LABEL.weekly, USAGE_EXTRA_LABEL.fable];

function resolveKindRank(kind: string) {
  const rank = KIND_ORDER.indexOf(kind);
  return rank === -1 ? KIND_ORDER.length : rank;
}

function resolveLineLabel(grant: UsageResetGrant, kind: string) {
  if (grant.label !== null) return grant.label;
  return kind === USAGE_EXTRA_LABEL.reset ? kind : `${kind} reset`;
}

function createResetLine(grant: UsageResetGrant, kind: string, now: number): UsageResetLine {
  return {
    id: grant.id,
    label: resolveLineLabel(grant, kind),
    value: `${grant.left} of ${grant.total} left`,
    detail: describeGrantDetail(grant, now),
    ending: isGrantEnding(grant, now),
  };
}

function compareEndsAt(a: UsageResetGrant, b: UsageResetGrant) {
  return (a.endsAt ?? Number.POSITIVE_INFINITY) - (b.endsAt ?? Number.POSITIVE_INFINITY);
}

function listResetParts(grants: UsageResetGrant[], now: number): UsageNotePart[] {
  const kinds = new Map<string, UsageResetGrant[]>();
  for (const grant of grants.filter((each) => each.left > 0)) {
    const kind = resolveGrantKind(grant);
    kinds.set(kind, [...(kinds.get(kind) ?? []), grant]);
  }
  return [...kinds.entries()]
    .sort(([a], [b]) => resolveKindRank(a) - resolveKindRank(b))
    .map(([kind, members]) => {
      const lines = [...members].sort(compareEndsAt).map((grant) => createResetLine(grant, kind, now));
      return {
        id: kind,
        label: kind,
        count: members.reduce((total, grant) => total + grant.left, 0),
        ending: lines.some((line) => line.ending),
        lines,
      };
    });
}

function createResetsRow(grants: UsageResetGrant[], now: number): UsageNoteRow[] {
  const parts = listResetParts(grants, now);
  if (parts.length === 0) return [];
  return [
    {
      id: 'resets',
      label: USAGE_EXTRA_LABEL.resets,
      value: parts.map((part) => `${part.label} ${part.count}`).join(' · '),
      detail: null,
      ending: parts.some((part) => part.ending),
      parts,
    },
  ];
}

function describeExtraUsageValue(enabled: boolean, noLimit: boolean) {
  if (!enabled) return USAGE_EXTRA_LABEL.off;
  return noLimit ? USAGE_EXTRA_LABEL.noLimit : USAGE_EXTRA_LABEL.on;
}

function listLiveGrants(usage: AccountUsage, now: number) {
  return (usage.resetGrants ?? []).filter((grant) => grant.endsAt === null || grant.endsAt > now);
}

export function listUsageNotes(usage: AccountUsage, now: number): UsageNoteRow[] {
  const extra = usage.extraUsage;
  const credit = extra?.credit;
  return [
    ...(extra
      ? [
          {
            id: 'extra-usage',
            label: USAGE_EXTRA_LABEL.extraUsage,
            value: describeExtraUsageValue(extra.enabled, extra.noLimit),
            detail: null,
            ending: false,
            parts: [],
          },
        ]
      : []),
    ...(credit && hasWholeCredit(credit)
      ? [
          {
            id: 'credit',
            label: USAGE_EXTRA_LABEL.credit,
            value: formatUsageMoney(credit),
            detail: null,
            ending: false,
            parts: [],
          },
        ]
      : []),
    ...createResetsRow(listLiveGrants(usage, now), now),
  ];
}

export function describeResetsAvailable(usage: AccountUsage, now: number): UsageResetsNote | null {
  const usable = listLiveGrants(usage, now).filter((grant) => grant.usableNow);
  const ending = usable.filter((grant) => isGrantEnding(grant, now));
  if (ending.length > 0) {
    const soonest = Math.min(...ending.map((grant) => grant.endsAt ?? Number.POSITIVE_INFINITY));
    const count = ending.reduce((total, grant) => total + grant.left, 0);
    const verb = count === 1 ? 'ends' : 'end';
    return {
      text: `${describeCount(count, 'usage reset')} ${verb} ${describeEndsIn(soonest, now)}`,
      ending: true,
    };
  }
  const count = usable.reduce((total, grant) => total + grant.left, 0);
  if (count === 0) return null;
  return { text: `${describeCount(count, 'usage reset')} available`, ending: false };
}
