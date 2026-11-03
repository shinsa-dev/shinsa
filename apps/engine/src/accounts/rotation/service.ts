import {
  type AccountCandidate,
  pickAccount,
  type RunFailure,
  resolveAccountSwitchAt,
  resolvePoolResetAt,
} from '@shinsa/core';
import { Effect, Ref } from 'effect';
import type {
  AccountLease,
  AccountLeaseRequest,
  RejectionVerdict,
  RunRejection,
} from '../../agents/index.ts';
import { AccountRegistry } from '../registry/service.ts';
import { describeExpiredLogin, isTokenFailure } from '../renewal/failures.ts';
import { type SpentMark, type StoredAccount, UNKNOWN_RESET_MS } from '../schema.ts';
import { isSharedLogin } from '../store.ts';
import {
  type AccountRotationDefinition,
  type AccountRotationHandle,
  MAX_ACCOUNTS_PER_EXECUTION,
} from './schema.ts';

export const makeAccountRotation = Effect.fn('AccountRotation.make')(function* (
  definition: AccountRotationDefinition
) {
  const registry = yield* AccountRegistry;
  const { store, limits, renewal } = definition;
  const spent = yield* Ref.make<ReadonlyMap<string, SpentMark>>(
    yield* registry.readMarks(definition.marksPath, yield* definition.now)
  );

  const persist = Effect.flatMap(Ref.get(spent), (marks) => registry.keepMarks(definition.marksPath, marks));

  const resolveSpentUntil = Effect.fn('AccountRotation.resolveSpentUntil')(function* (
    accountId: string,
    knownResets: boolean
  ) {
    const mark = (yield* Ref.get(spent)).get(accountId);
    if (!mark) return null;
    if (mark.until === null) return knownResets ? null : mark.at + UNKNOWN_RESET_MS;
    return mark.until;
  });

  const clear = Effect.fn('AccountRotation.clear')(function* (accountId: string) {
    const removed = yield* Ref.modify(spent, (marks) => {
      if (!marks.has(accountId)) return [false, marks];
      const rest = new Map(marks);
      rest.delete(accountId);
      return [true, rest];
    });
    if (removed) yield* persist;
  });

  const mark = Effect.fn('AccountRotation.mark')(function* (accountId: string, marked: SpentMark) {
    yield* Ref.update(spent, (marks) => new Map(marks).set(accountId, marked));
    yield* persist;
  });

  const listCandidates = Effect.fn('AccountRotation.listCandidates')(function* (knownResets: boolean) {
    const threshold = resolveAccountSwitchAt((yield* definition.state).settings);
    const duplicates = yield* store.resolveDuplicates;
    const candidates: AccountCandidate[] = [];
    for (const account of yield* store.listDistinct) {
      if (isSharedLogin(account)) continue;
      candidates.push({
        id: account.id,
        isDefault: yield* store.isDefault(account.id, duplicates),
        paused: account.paused,
        signIn: (yield* definition.selectSignIn(account.id)) ?? 'unknown',
        usage: yield* limits.snapshot(account.id),
        spentUntil: yield* resolveSpentUntil(account.id, knownResets),
        switchAt: account.switchAt ?? threshold,
      });
    }
    return candidates;
  });

  const resolveKept = Effect.fn('AccountRotation.resolveKept')(function* (id: string | null) {
    if (id === null) return null;
    return (yield* store.resolveDuplicates).get(id) ?? id;
  });

  const lease = Effect.fn('AccountRotation.lease')(function* (request: AccountLeaseRequest) {
    const ids = (yield* store.listDistinct).map((stored) => stored.id);
    if (ids.length === 0) return null;
    const stale: string[] = [];
    for (const id of ids) if (!(yield* limits.isFresh(id))) stale.push(id);
    if (stale.length > 0) yield* Effect.forkDetach(limits.refresh(stale, false));
    const picked = pickAccount({
      accounts: yield* listCandidates(false),
      bound: yield* resolveKept(request.bound?.id ?? null),
      previous: yield* resolveKept(request.previous?.id ?? null),
      model: request.model,
      exclude: new Set(request.exclude),
      now: yield* definition.now,
    });
    if (!picked) {
      yield* Effect.logWarning(
        '[Accounts] The account a task is bound to is gone; using the default login'
      ).pipe(Effect.annotateLogs({ taskId: request.taskId, accountId: request.bound?.id }));
      return null;
    }
    const account = yield* store.find(picked.account.id);
    if (account.configDir) yield* store.linkSharedEntries(account.configDir);
    const leased: AccountLease = {
      id: account.id,
      email: account.email,
      configDir: account.configDir,
      reason: picked.reason,
    };
    return leased;
  });

  const recordAccountFailure = Effect.fn('AccountRotation.recordAccountFailure')(function* (
    rejection: RunRejection,
    account: StoredAccount
  ) {
    const { failure } = rejection;
    const now = yield* definition.now;
    if (failure.class === 'usage_limit') yield* mark(account.id, { until: failure.resetAt, at: now });
    else yield* definition.markSignedOut(account.id, failure.message);
    yield* definition.changed;
    const refined: RunFailure = { ...failure, account: { id: account.id, email: account.email } };
    const state = yield* definition.state;
    const model = state.runs[rejection.runId]?.model ?? null;
    const bound = state.runs[rejection.runId]?.account ?? state.tasks[rejection.taskId]?.account ?? null;
    if (!bound && rejection.tried.length < MAX_ACCOUNTS_PER_EXECUTION) {
      const next = pickAccount({
        accounts: yield* listCandidates(false),
        bound: null,
        previous: account.id,
        model,
        exclude: new Set(rejection.tried),
        now,
      });
      if (next?.usable) {
        yield* Effect.logInfo('[Accounts] Moving a run to another account').pipe(
          Effect.annotateLogs({
            runId: rejection.runId,
            from: account.id,
            to: next.account.id,
            reason: failure.class,
          })
        );
        const retry: RejectionVerdict = { retry: true };
        return retry;
      }
    }
    if (failure.class === 'auth') {
      const refused: RejectionVerdict = { retry: false, failure: refined };
      return refused;
    }
    const kept = bound ? yield* resolveKept(bound.id) : null;
    const candidates = (yield* listCandidates(true)).filter((candidate) => !bound || candidate.id === kept);
    const resetAt = resolvePoolResetAt(candidates, model, now) ?? failure.resetAt;
    const spentVerdict: RejectionVerdict = { retry: false, failure: { ...refined, resetAt } };
    return spentVerdict;
  });

  const recordTokenFailure = Effect.fn('AccountRotation.recordTokenFailure')(function* (
    rejection: RunRejection,
    account: StoredAccount
  ) {
    if (!rejection.renewed.includes(account.id) && (yield* renewal.renew(account))) {
      yield* Effect.logInfo(
        '[Accounts] Read a login again after Claude could not refresh it; trying the same account once more'
      ).pipe(Effect.annotateLogs({ runId: rejection.runId, accountId: account.id }));
      const renewed: RejectionVerdict = { retry: true, renewed: account.id };
      return renewed;
    }
    yield* renewal.recordFailed(account);
    const verdict = yield* recordAccountFailure(rejection, account);
    if (!verdict.failure) return verdict;
    const others: StoredAccount[] = [];
    for (const id of rejection.tried) {
      const other = id === account.id ? null : yield* store.select(id);
      if (other && (yield* definition.selectSignIn(id)) === 'signed_out') others.push(other);
    }
    const message = describeExpiredLogin(account, others);
    const expired: RejectionVerdict = {
      retry: false,
      failure: { ...verdict.failure, code: 'login_expired', message },
    };
    return expired;
  });

  const recordRejection = Effect.fn('AccountRotation.recordRejection')(function* (rejection: RunRejection) {
    const { failure } = rejection;
    const skip: RejectionVerdict = { retry: false };
    if (failure.class !== 'usage_limit' && failure.class !== 'auth') return skip;
    const account = rejection.accountId ? yield* store.select(rejection.accountId) : null;
    if (!account) return skip;
    if (isTokenFailure(failure)) return recordTokenFailure(rejection, account);
    return yield* recordAccountFailure(rejection, account);
  });

  const handle: AccountRotationHandle = { resolveSpentUntil, clear, lease, recordRejection };
  return handle;
});
