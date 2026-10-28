import type {
  AccountSwitchReason,
  FastModeAvailability,
  Run,
  RunAccount,
  RunFailure,
  ShinsaState,
  WeeklyReading,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Transcripts } from './transcripts/index.ts';

export interface RunRejection {
  runId: string;
  taskId: string;
  provider: string;
  attemptId: string;
  accountId: string | null;
  tried: string[];
  renewed: string[];
  failure: RunFailure;
}

export interface RejectionVerdict {
  retry: boolean;
  failure?: RunFailure;
  renewed?: string;
}

export type RejectionHandler = (rejection: RunRejection) => Promise<RejectionVerdict> | RejectionVerdict;

export interface AccountLease {
  id: string;
  email: string | null;
  configDir: string | null;
  reason: AccountSwitchReason | null;
}

export interface AccountLeaseRequest {
  runId: string;
  taskId: string;
  model: string | null;
  bound: RunAccount | null;
  previous: RunAccount | null;
  exclude: string[];
}

export interface AccountBroker {
  lease: (request: AccountLeaseRequest) => Promise<AccountLease | null>;
  readWeeklyReading: (accountId: string, force: boolean) => Promise<WeeklyReading | null>;
  readProviderWeeklyReading: (provider: string, force: boolean) => Promise<WeeklyReading | null>;
  readFastMode: (provider: string, accountId: string | null) => Promise<FastModeAvailability>;
}

export async function requestVerdict(handler: RejectionHandler, rejection: RunRejection) {
  try {
    return await handler(rejection);
  } catch (error) {
    log.warn('[Runs] The rejection handler failed; the run ends', {
      runId: rejection.runId,
      error: describeError(error),
    });
    return { retry: false };
  }
}

function selectPreviousAccount(state: ShinsaState, taskId: string): RunAccount | null {
  let latest: { at: number; account: RunAccount } | null = null;
  for (const run of Object.values(state.runs)) {
    if (run.taskId !== taskId) continue;
    for (const attempt of run.attempts ?? []) {
      if (attempt.account && (!latest || attempt.startedAt >= latest.at)) {
        latest = { at: attempt.startedAt, account: attempt.account };
      }
    }
  }
  return latest?.account ?? null;
}

export class AccountLeasing {
  readonly #broker: AccountBroker | null;
  readonly #state: () => ShinsaState;
  readonly #transcripts: Transcripts;

  constructor(broker: AccountBroker | null, state: () => ShinsaState, transcripts: Transcripts) {
    this.#broker = broker;
    this.#state = state;
    this.#transcripts = transcripts;
  }

  async leaseAttempt(run: Run, exclude: string[], renewed: RunAccount | null = null) {
    if (!this.#broker) return null;
    const state = this.#state();
    const previous = selectPreviousAccount(state, run.taskId);
    const lease = await this.#broker.lease({
      runId: run.id,
      taskId: run.taskId,
      model: run.model,
      bound: renewed ?? run.account ?? state.tasks[run.taskId]?.account ?? null,
      previous,
      exclude,
    });
    if (lease && previous && previous.id !== lease.id) {
      this.#transcripts.record(run.id, {
        type: 'notice',
        notice: {
          kind: 'account_switched',
          email: lease.email,
          previous: previous.email,
          reason: lease.reason ?? 'headroom',
        },
      });
    }
    return lease;
  }

  async readWeeklyReading(runId: string, lease: AccountLease | null, provider: string, force: boolean) {
    if (!this.#broker) return null;
    try {
      if (!lease) return await this.#broker.readProviderWeeklyReading(provider, force);
      return await this.#broker.readWeeklyReading(lease.id, force);
    } catch (error) {
      log.warn('[Runs] Could not read the weekly usage a run is charged against', {
        runId,
        accountId: lease?.id ?? null,
        error: describeError(error),
      });
      return null;
    }
  }

  readFastMode(lease: AccountLease | null, provider: string): Promise<FastModeAvailability> {
    if (!this.#broker) return Promise.resolve('available');
    return this.#broker.readFastMode(provider, lease?.id ?? null);
  }

  leaseSession(run: Run) {
    const account = run.attempts?.at(-1)?.account ?? null;
    if (!account || !this.#broker) return null;
    return this.#broker.lease({
      runId: run.id,
      taskId: run.taskId,
      model: run.model,
      bound: account,
      previous: account,
      exclude: [],
    });
  }
}
