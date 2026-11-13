import { Option } from 'effect';
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
  const marked = Option.filter(Option.fromNullOr(candidate.spentUntil), (until) => until > now);
  const measured = resolveSpentUntil(candidate.usage, model, now);
  return Option.isSome(marked) && Option.isSome(measured)
    ? Option.some(Math.max(marked.value, measured.value))
    : Option.orElse(marked, () => measured);
}

export function isUsableAccount(candidate: AccountCandidate, model: string | null, now: number) {
  return (
    !candidate.paused &&
    candidate.signIn !== 'signed_out' &&
    Option.isNone(resolveCandidateSpentUntil(candidate, model, now))
  );
}

function isBelowThreshold(candidate: AccountCandidate, model: string | null) {
  return Option.getOrElse(resolveUsedPercent(candidate.usage, model), () => 0) < candidate.switchAt;
}

function rankByHeadroom(candidates: AccountCandidate[], model: string | null) {
  return [...candidates].sort((a, b) => {
    const left = resolveHeadroom(a.usage, model);
    const right = resolveHeadroom(b.usage, model);
    if (Option.isNone(left)) return Option.isNone(right) ? 0 : 1;
    if (Option.isNone(right)) return -1;
    return right.value - left.value;
  });
}

function resolveWeeklyResetsAt(candidate: AccountCandidate) {
  return (
    candidate.usage.windows.find((window) => window.kind === 'weekly')?.resetsAt ?? Number.POSITIVE_INFINITY
  );
}

function rankBySoonestReset(candidates: AccountCandidate[], model: string | null) {
  const ranked = rankByHeadroom(candidates, model);
  return ranked.sort((a, b) => resolveWeeklyResetsAt(a) - resolveWeeklyResetsAt(b));
}

function rankLeastSpent(candidates: AccountCandidate[], model: string | null, now: number) {
  return [...candidates].sort((a, b) => {
    const signedIn = Number(a.signIn === 'signed_out') - Number(b.signIn === 'signed_out');
    if (signedIn !== 0) return signedIn;
    return (
      Option.getOrElse(resolveCandidateSpentUntil(a, model, now), () => 0) -
      Option.getOrElse(resolveCandidateSpentUntil(b, model, now), () => 0)
    );
  });
}

function resolveReason(request: PickRequest, chosen: AccountCandidate): AccountSwitchReason | null {
  const previous = request.accounts.find((account) => account.id === request.previous);
  if (!previous || previous.id === chosen.id) return null;
  if (previous.signIn === 'signed_out') return 'signed_out';
  if (Option.isSome(resolveCandidateSpentUntil(previous, request.model, request.now))) return 'usage_limit';
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
    rankBySoonestReset(below, model)[0] ??
    rankByHeadroom(usable, model)[0] ??
    null
  );
}

export function pickAccount(request: PickRequest): Option.Option<PickedAccount> {
  const { accounts, model, now } = request;
  if (request.bound !== null) {
    const bound = accounts.find((account) => account.id === request.bound);
    if (!bound) return Option.none();
    const moved = request.previous !== null && request.previous !== bound.id;
    return Option.some({
      account: bound,
      reason: moved ? 'bound' : null,
      usable: isUsableAccount(bound, model, now),
    });
  }
  const usable = pickUsable(request);
  if (usable) return Option.some({ account: usable, reason: resolveReason(request, usable), usable: true });
  const untried = accounts.filter((account) => !request.exclude.has(account.id));
  const fallback =
    rankLeastSpent(
      untried.filter((account) => !account.paused),
      model,
      now
    )[0] ??
    untried.find((account) => account.isDefault) ??
    untried[0];
  if (!fallback) return Option.none();
  return Option.some({ account: fallback, reason: resolveReason(request, fallback), usable: false });
}

export function resolvePoolResetAt(accounts: AccountCandidate[], model: string | null, now: number) {
  const resets = Option.all(
    accounts
      .filter((account) => !account.paused && account.signIn !== 'signed_out')
      .map((account) => resolveCandidateSpentUntil(account, model, now))
  );
  return Option.flatMap(resets, (until) =>
    until.length === 0 ? Option.none() : Option.some(Math.min(...until))
  );
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
  return Option.flatMap(picked, (chosen) =>
    Option.fromNullishOr(accounts.find((account) => account.id === chosen.account.id))
  );
}
