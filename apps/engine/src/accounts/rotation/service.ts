import { join } from 'node:path';
import {
  type AccountCandidate,
  DomainError,
  isSharedMachine,
  OWNER_SIGNED_OUT_CODE,
  pickAccount,
  type RunFailure,
  resolveAccountSwitchAt,
  resolveLimitScope,
  resolvePoolResetAt,
  type UsageLimitScope,
} from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Ref } from 'effect';
import type {
  AccountLease,
  AccountLeaseRequest,
  AccountOwnership,
  RejectionVerdict,
  RunRejection,
} from '../../agents/accounts/schema.ts';
import { EngineConfig } from '../../config/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { AccountChanges } from '../changes/service.ts';
import { UsageLimits } from '../limits/service.ts';
import { AccountRegistry } from '../registry/service.ts';
import { describeExpiredLogin, isTokenFailure } from '../renewal/failures.ts';
import { LoginRenewal } from '../renewal/service.ts';
import type { SpentMark, StoredAccount } from '../schema.ts';
import { AccountSignIns } from '../sign-ins/service.ts';
import { isSharedLogin } from '../store/identity.ts';
import { AccountStore } from '../store/service.ts';
import { replaceMark, resolveSpentReading, type SpentReading } from './marks.ts';
import { MARKS_FILE, MAX_ACCOUNTS_PER_EXECUTION } from './schema.ts';

export class AccountRotation extends Context.Service<
  AccountRotation,
  {
    resolveSpent(
      accountId: string,
      knownResets: boolean,
      model: string | null
    ): Effect.Effect<SpentReading | null>;
    clear(accountId: string): Effect.Effect<void>;
    lease(request: AccountLeaseRequest): Effect.Effect<AccountLease | null, DomainError>;
    recordRejection(rejection: RunRejection): Effect.Effect<RejectionVerdict>;
  }
>()('shinsa/engine/accounts/rotation/AccountRotation') {
  static readonly layer = Layer.effect(
    AccountRotation,
    Effect.gen(function* () {
      const registry = yield* AccountRegistry;
      const store = yield* AccountStore;
      const limits = (yield* UsageLimits).claude;
      const renewal = yield* LoginRenewal;
      const signIns = yield* AccountSignIns;
      const changes = yield* AccountChanges;
      const engine = yield* EngineCore;
      const marksPath = join((yield* EngineConfig).dataDir, MARKS_FILE);
      const spent = yield* Ref.make<ReadonlyMap<string, readonly SpentMark[]>>(
        yield* registry.readMarks(marksPath, yield* Clock.currentTimeMillis)
      );

      const selectSignIn = (accountId: string) =>
        Effect.map(signIns.select(accountId), (state) => state?.signIn ?? null);

      const persist = Effect.flatMap(Ref.get(spent), (marks) => registry.keepMarks(marksPath, marks));

      const resolveSpent = Effect.fn('AccountRotation.resolveSpent')(function* (
        accountId: string,
        knownResets: boolean,
        model: string | null
      ) {
        return resolveSpentReading((yield* Ref.get(spent)).get(accountId) ?? [], model, knownResets);
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
        yield* Ref.update(spent, (marks) =>
          new Map(marks).set(accountId, replaceMark(marks.get(accountId) ?? [], marked))
        );
        yield* persist;
      });

      const listCandidates = Effect.fn('AccountRotation.listCandidates')(function* (
        knownResets: boolean,
        ownership: AccountOwnership | null,
        model: string | null
      ) {
        const threshold = resolveAccountSwitchAt((yield* engine.state).settings);
        const duplicates = yield* store.resolveDuplicates;
        const candidates: AccountCandidate[] = [];
        for (const account of yield* store.listDistinct) {
          if (isSharedLogin(account)) continue;
          if (ownership && account.owner !== ownership.owner) continue;
          const reading = yield* resolveSpent(account.id, knownResets, model);
          candidates.push({
            id: account.id,
            isDefault: yield* store.isDefault(account.id, duplicates),
            paused: account.paused,
            signIn: (yield* selectSignIn(account.id)) ?? 'unknown',
            usage: yield* limits.snapshot(account.id),
            spentUntil: reading?.until ?? null,
            spentModel: reading?.model ?? null,
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
        const ownership = request.ownership ?? null;
        const accounts = yield* listCandidates(false, ownership, request.model);
        const bound = yield* resolveKept(request.bound?.id ?? null);
        const chosen = pickAccount({
          accounts,
          bound: ownership && !accounts.some((account) => account.id === bound) ? null : bound,
          previous: yield* resolveKept(request.previous?.id ?? null),
          model: request.model,
          exclude: new Set(request.exclude),
          now: yield* Clock.currentTimeMillis,
        });
        if (Option.isNone(chosen) && ownership) {
          return yield* new DomainError({
            code: OWNER_SIGNED_OUT_CODE,
            message: 'The task’s owner has no Claude account it can use on this shared machine.',
          });
        }
        if (Option.isNone(chosen)) {
          yield* Effect.logWarning(
            '[Accounts] The account a task is bound to is gone; using the default login'
          ).pipe(Effect.annotateLogs({ taskId: request.taskId, accountId: request.bound?.id }));
          return null;
        }
        const picked = chosen.value;
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

      const resolveScope = Effect.fn('AccountRotation.resolveScope')(function* (
        failure: RunFailure,
        accountId: string,
        model: string | null
      ) {
        if (failure.limitScope) return failure.limitScope;
        if (model === null) return 'account' satisfies UsageLimitScope;
        yield* limits.refresh([accountId], true);
        return resolveLimitScope(yield* limits.snapshot(accountId), model, yield* Clock.currentTimeMillis);
      });

      const recordFailureMark = Effect.fn('AccountRotation.recordFailureMark')(function* (
        failure: RunFailure,
        accountId: string,
        model: string | null
      ) {
        if (failure.class !== 'usage_limit') {
          yield* signIns.record(accountId, { signIn: 'signed_out', detail: failure.message });
          yield* changes.notify;
          return null;
        }
        const scope = yield* resolveScope(failure, accountId, model);
        const own = scope === 'model' && model !== null ? { model } : {};
        yield* mark(accountId, { until: failure.resetAt, at: yield* Clock.currentTimeMillis, ...own });
        yield* changes.notify;
        return scope;
      });

      const recordAccountFailure = Effect.fn('AccountRotation.recordAccountFailure')(function* (
        rejection: RunRejection,
        account: StoredAccount
      ) {
        const { failure } = rejection;
        const state = yield* engine.state;
        const model = state.runs[rejection.runId]?.model ?? null;
        const scope = yield* recordFailureMark(failure, account.id, model);
        const now = yield* Clock.currentTimeMillis;
        const refined: RunFailure = {
          ...failure,
          account: { id: account.id, email: account.email },
          ...(scope === null ? {} : { model, limitScope: scope }),
        };
        const ownership: AccountOwnership | null = isSharedMachine(state.settings)
          ? { owner: account.owner }
          : null;
        const bound = state.runs[rejection.runId]?.account ?? state.tasks[rejection.taskId]?.account ?? null;
        if (!bound && rejection.tried.length < MAX_ACCOUNTS_PER_EXECUTION) {
          const next = pickAccount({
            accounts: yield* listCandidates(false, ownership, model),
            bound: null,
            previous: account.id,
            model,
            exclude: new Set(rejection.tried),
            now,
          });
          if (Option.isSome(next) && next.value.usable) {
            yield* Effect.logInfo('[Accounts] Moving a run to another account').pipe(
              Effect.annotateLogs({
                runId: rejection.runId,
                from: account.id,
                to: next.value.account.id,
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
        const candidates = (yield* listCandidates(true, ownership, model)).filter(
          (candidate) => !bound || candidate.id === kept
        );
        const resetAt = Option.getOrUndefined(resolvePoolResetAt(candidates, model, now)) ?? failure.resetAt;
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
          if (other && (yield* selectSignIn(id)) === 'signed_out') others.push(other);
        }
        const message = describeExpiredLogin(account, others);
        const expired: RejectionVerdict = {
          retry: false,
          failure: { ...verdict.failure, code: 'login_expired', message },
        };
        return expired;
      });

      const recordRejection = Effect.fn('AccountRotation.recordRejection')(function* (
        rejection: RunRejection
      ) {
        const { failure } = rejection;
        const skip: RejectionVerdict = { retry: false };
        if (failure.class !== 'usage_limit' && failure.class !== 'auth') return skip;
        const account = rejection.accountId ? yield* store.select(rejection.accountId) : null;
        if (!account) return skip;
        if (isTokenFailure(failure)) return yield* recordTokenFailure(rejection, account);
        return yield* recordAccountFailure(rejection, account);
      });

      return AccountRotation.of({ resolveSpent, clear, lease, recordRejection });
    })
  );
}
