import { type AccountSwitchReason, resolveAccountSwitchAt, type Settings } from '../domain/index.ts';
import type { AccountSignIn, AccountSummary, AccountUsage } from '../protocol/accounts.ts';
import { resolveHeadroom, resolveSpentUntil, resolveUsedPercent } from './usage.ts';

export interface AccountCandidate {
  id: string;
  isDefault: boolean;
  paused: boolean;
  signIn: AccountSignIn;
  usage: AccountUsage;
  spentUntil: number | null;
  switchAt: number;
}

export interface PickRequest {
  accounts: AccountCandidate[];
  bound: string | null;
  previous: string | null;
  model: string | null;
  exclude: ReadonlySet<string>;
  now: number;
}

export interface PickedAccount {
  account: AccountCandidate;
  reason: AccountSwitchReason | null;
  usable: boolean;
}

export function resolveCandidateSpentUntil(
  candidate: Pick<AccountCandidate, 'spentUntil' | 'usage'>,
  model: string | null,
  now: number
) {
  const marked = candidate.spentUntil !== null && candidate.spentUntil > now ? candidate.spentUntil : null;
  const measured = resolveSpentUntil(candidate.usage, model, now);
  if (marked === null) return measured;
  return measured === null ? marked : Math.max(marked, measured);
}

export function isUsableAccount(candidate: AccountCandidate, model: string | null, now: number) {
  return (
    !candidate.paused &&
    candidate.signIn !== 'signed_out' &&
    resolveCandidateSpentUntil(candidate, model, now) === null
  );
}

function isBelowThreshold(candidate: AccountCandidate, model: string | null) {
  return (resolveUsedPercent(candidate.usage, model) ?? 0) < candidate.switchAt;
}

function rankByHeadroom(candidates: AccountCandidate[], model: string | null) {
  return [...candidates].sort((a, b) => {
    const left = resolveHeadroom(a.usage, model);
    const right = resolveHeadroom(b.usage, model);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
}

function rankLeastSpent(candidates: AccountCandidate[], model: string | null, now: number) {
  return [...candidates].sort((a, b) => {
    const signedIn = Number(a.signIn === 'signed_out') - Number(b.signIn === 'signed_out');
    if (signedIn !== 0) return signedIn;
    return (
      (resolveCandidateSpentUntil(a, model, now) ?? 0) - (resolveCandidateSpentUntil(b, model, now) ?? 0)
    );
  });
}

function resolveReason(request: PickRequest, chosen: AccountCandidate): AccountSwitchReason | null {
  const previous = request.accounts.find((account) => account.id === request.previous);
  if (!previous || previous.id === chosen.id) return null;
  if (previous.signIn === 'signed_out') return 'signed_out';
  if (resolveCandidateSpentUntil(previous, request.model, request.now) !== null) return 'usage_limit';
  return 'headroom';
}

function pickUsable(request: PickRequest) {
  const { model, now } = request;
  const usable = request.accounts.filter(
    (account) => !request.exclude.has(account.id) && isUsableAccount(account, model, now)
  );
  const below = usable.filter((account) => isBelowThreshold(account, model));
  return (
    below.find((account) => account.id === request.previous) ??
    below.find((account) => account.isDefault) ??
    rankByHeadroom(below, model)[0] ??
    rankByHeadroom(usable, model)[0] ??
    null
  );
}

export function pickAccount(request: PickRequest): PickedAccount | null {
  const { accounts, model, now } = request;
  if (request.bound !== null) {
    const bound = accounts.find((account) => account.id === request.bound);
    if (!bound) return null;
    const moved = request.previous !== null && request.previous !== bound.id;
    return { account: bound, reason: moved ? 'bound' : null, usable: isUsableAccount(bound, model, now) };
  }
  const usable = pickUsable(request);
  if (usable) return { account: usable, reason: resolveReason(request, usable), usable: true };
  const untried = accounts.filter((account) => !request.exclude.has(account.id));
  const fallback =
    rankLeastSpent(
      untried.filter((account) => !account.paused),
      model,
      now
    )[0] ??
    untried.find((account) => account.isDefault) ??
    untried[0];
  if (!fallback) return null;
  return { account: fallback, reason: resolveReason(request, fallback), usable: false };
}

export function resolvePoolResetAt(accounts: AccountCandidate[], model: string | null, now: number) {
  const resets = accounts
    .filter((account) => !account.paused && account.signIn !== 'signed_out')
    .map((account) => resolveCandidateSpentUntil(account, model, now));
  if (resets.length === 0 || resets.some((reset) => reset === null)) return null;
  return Math.min(...(resets as number[]));
}

export function resolveAccountCandidate(account: AccountSummary, settings: Settings): AccountCandidate {
  return {
    id: account.id,
    isDefault: account.isDefault,
    paused: account.paused,
    signIn: account.signIn,
    usage: account.usage,
    spentUntil: account.spentUntil,
    switchAt: account.switchAt ?? resolveAccountSwitchAt(settings),
  };
}

export function selectNextAccount(
  accounts: AccountSummary[],
  settings: Settings,
  model: string | null,
  now: number
) {
  const picked = pickAccount({
    accounts: accounts.map((account) => resolveAccountCandidate(account, settings)),
    bound: null,
    previous: null,
    model,
    exclude: new Set(),
    now,
  });
  return accounts.find((account) => account.id === picked?.account.id) ?? null;
}
