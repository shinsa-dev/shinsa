import { existsSync, readFileSync } from 'node:fs';
import {
  type AccountCandidate,
  type AccountSignIn,
  pickAccount,
  type RunFailure,
  resolveAccountSwitchAt,
  resolvePoolResetAt,
  type ShinsaState,
} from '@shinsa/core';
import type { AccountLease, AccountLeaseRequest, RejectionVerdict, RunRejection } from '../agents/index.ts';
import { writeJsonFile } from '../config/file.ts';
import { describeError, log } from '../log/index.ts';
import type { UsageLimits } from './limits.ts';
import { describeExpiredLogin, isTokenFailure, type LoginRenewal } from './renewal.ts';
import { type AccountStore, isCopiedLogin, type StoredAccount } from './store.ts';

export interface SignInState {
  signIn: AccountSignIn;
  detail: string | null;
}

export interface AccountRotationOptions {
  store: AccountStore;
  limits: UsageLimits;
  renewal: LoginRenewal;
  signIns: Map<string, SignInState>;
  state: () => ShinsaState;
  now: () => number;
  onChange: () => void;
  marksPath: string;
}

interface SpentMark {
  until: number | null;
  at: number;
}

const MAX_ACCOUNTS_PER_EXECUTION = 3;

const UNKNOWN_RESET_MS = 15 * 60_000;

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSpentMark(value: unknown): value is SpentMark {
  if (typeof value !== 'object' || value === null) return false;
  const mark = value as Record<string, unknown>;
  return isTime(mark.at) && (mark.until === null || isTime(mark.until));
}

function resolveMarkEnd(mark: SpentMark) {
  return mark.until ?? mark.at + UNKNOWN_RESET_MS;
}

function readMarks(path: string, now: number) {
  const marks = new Map<string, SpentMark>();
  if (!existsSync(path)) return marks;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { marks?: Record<string, unknown> };
    for (const [accountId, mark] of Object.entries(parsed.marks ?? {})) {
      if (isSpentMark(mark) && resolveMarkEnd(mark) > now) marks.set(accountId, mark);
    }
  } catch (error) {
    log.warn('[Accounts] The spent accounts could not be read; starting without them', {
      path,
      error: describeError(error),
    });
  }
  return marks;
}

export class AccountRotation {
  readonly #options: AccountRotationOptions;
  readonly #spent: Map<string, SpentMark>;

  constructor(options: AccountRotationOptions) {
    this.#options = options;
    this.#spent = readMarks(options.marksPath, options.now());
  }

  resolveSpentUntil(accountId: string, knownResets = false) {
    const mark = this.#spent.get(accountId);
    if (!mark) return null;
    if (mark.until === null) return knownResets ? null : mark.at + UNKNOWN_RESET_MS;
    return mark.until;
  }

  clear(accountId: string) {
    if (this.#spent.delete(accountId)) this.#persist();
  }

  #mark(accountId: string, mark: SpentMark) {
    this.#spent.set(accountId, mark);
    this.#persist();
  }

  #persist() {
    try {
      writeJsonFile(this.#options.marksPath, { version: 1, marks: Object.fromEntries(this.#spent) });
    } catch (error) {
      log.warn('[Accounts] Could not keep the spent accounts', { error: describeError(error) });
    }
  }

  #listCandidates(knownResets: boolean): AccountCandidate[] {
    const { store, limits, signIns, state } = this.#options;
    const threshold = resolveAccountSwitchAt(state().settings);
    const duplicates = store.resolveDuplicates();
    return store
      .listDistinct()
      .filter((account) => !isCopiedLogin(account))
      .map((account) => ({
        id: account.id,
        isDefault: store.isDefault(account.id, duplicates),
        paused: account.paused,
        signIn: signIns.get(account.id)?.signIn ?? 'unknown',
        usage: limits.snapshot(account.id),
        spentUntil: this.resolveSpentUntil(account.id, knownResets),
        switchAt: account.switchAt ?? threshold,
      }));
  }

  #resolveKept(id: string | null) {
    if (id === null) return null;
    return this.#options.store.resolveDuplicates().get(id) ?? id;
  }

  lease(request: AccountLeaseRequest): AccountLease | null {
    const { store, limits } = this.#options;
    const ids = store.listDistinct().map((stored) => stored.id);
    if (ids.length === 0) return null;
    const stale = ids.filter((id) => !limits.isFresh(id));
    if (stale.length > 0) void limits.refresh(stale);
    const picked = pickAccount({
      accounts: this.#listCandidates(false),
      bound: this.#resolveKept(request.bound?.id ?? null),
      previous: this.#resolveKept(request.previous?.id ?? null),
      model: request.model,
      exclude: new Set(request.exclude),
      now: this.#options.now(),
    });
    if (!picked) {
      log.warn('[Accounts] The account a task is bound to is gone; using the default login', {
        taskId: request.taskId,
        accountId: request.bound?.id,
      });
      return null;
    }
    const account = store.find(picked.account.id);
    if (account.configDir) store.linkSharedEntries(account.configDir);
    return { id: account.id, email: account.email, configDir: account.configDir, reason: picked.reason };
  }

  recordRejection(rejection: RunRejection): RejectionVerdict | Promise<RejectionVerdict> {
    const { failure } = rejection;
    if (failure.class !== 'usage_limit' && failure.class !== 'auth') return { retry: false };
    const account = rejection.accountId ? this.#options.store.select(rejection.accountId) : null;
    if (!account) return { retry: false };
    if (isTokenFailure(failure)) return this.#recordTokenFailure(rejection, account);
    return this.#recordAccountFailure(rejection, account);
  }

  async #recordTokenFailure(rejection: RunRejection, account: StoredAccount): Promise<RejectionVerdict> {
    const { renewal } = this.#options;
    if (!rejection.renewed.includes(account.id) && (await renewal.renew(account))) {
      log.info(
        '[Accounts] Read a login again after Claude could not refresh it; trying the same account once more',
        {
          runId: rejection.runId,
          accountId: account.id,
        }
      );
      return { retry: true, renewed: account.id };
    }
    await renewal.recordFailed(account);
    const verdict = this.#recordAccountFailure(rejection, account);
    if (!verdict.failure) return verdict;
    const others = rejection.tried.flatMap((id) => {
      const other = id === account.id ? null : this.#options.store.select(id);
      return other && this.#options.signIns.get(id)?.signIn === 'signed_out' ? [other] : [];
    });
    const message = describeExpiredLogin(account, others);
    return { retry: false, failure: { ...verdict.failure, code: 'login_expired', message } };
  }

  #recordAccountFailure(rejection: RunRejection, account: StoredAccount): RejectionVerdict {
    const { failure } = rejection;
    const now = this.#options.now();
    if (failure.class === 'usage_limit') this.#mark(account.id, { until: failure.resetAt, at: now });
    else this.#options.signIns.set(account.id, { signIn: 'signed_out', detail: failure.message });
    this.#options.onChange();
    const refined: RunFailure = { ...failure, account: { id: account.id, email: account.email } };
    const state = this.#options.state();
    const model = state.runs[rejection.runId]?.model ?? null;
    const bound = state.runs[rejection.runId]?.account ?? state.tasks[rejection.taskId]?.account ?? null;
    if (!bound && rejection.tried.length < MAX_ACCOUNTS_PER_EXECUTION) {
      const next = pickAccount({
        accounts: this.#listCandidates(false),
        bound: null,
        previous: account.id,
        model,
        exclude: new Set(rejection.tried),
        now,
      });
      if (next?.usable) {
        log.info('[Accounts] Moving a run to another account', {
          runId: rejection.runId,
          from: account.id,
          to: next.account.id,
          reason: failure.class,
        });
        return { retry: true };
      }
    }
    if (failure.class === 'auth') return { retry: false, failure: refined };
    const candidates = bound
      ? this.#listCandidates(true).filter((candidate) => candidate.id === this.#resolveKept(bound.id))
      : this.#listCandidates(true);
    const resetAt = resolvePoolResetAt(candidates, model, now) ?? failure.resetAt;
    return { retry: false, failure: { ...refined, resetAt } };
  }
}
