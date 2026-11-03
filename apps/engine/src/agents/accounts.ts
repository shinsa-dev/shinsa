import type { FastModeAvailability, Run, RunAccount, ShinsaState, WeeklyReading } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  type AccountBroker,
  AccountBrokerFailed,
  type AccountLease,
  type AccountLeasingHandle,
  type RejectionHandler,
  RejectionHandlerFailed,
  type RejectionVerdict,
  type RunRejection,
} from './accounts/schema.ts';
import { makeAccountLeasing } from './accounts/service.ts';
import type { Transcripts } from './transcripts/index.ts';

export type {
  AccountBroker,
  AccountLease,
  AccountLeaseRequest,
  RejectionHandler,
  RejectionVerdict,
  RunRejection,
} from './accounts/schema.ts';

export function requestVerdict(
  handler: RejectionHandler,
  rejection: RunRejection
): Promise<RejectionVerdict> {
  return edgeRuntime.runPromise(
    Effect.tryPromise({
      try: () => Promise.resolve(handler(rejection)),
      catch: (error) => new RejectionHandlerFailed({ message: describeError(error) }),
    }).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Runs] The rejection handler failed; the run ends').pipe(
          Effect.annotateLogs({ runId: rejection.runId, error: failure.message }),
          Effect.as({ retry: false })
        )
      )
    )
  );
}

function brokerFailed(error: unknown) {
  return new AccountBrokerFailed({ message: describeError(error) });
}

export class AccountLeasing {
  readonly #handle: AccountLeasingHandle;

  constructor(broker: AccountBroker | null, state: () => ShinsaState, transcripts: Transcripts) {
    this.#handle = makeAccountLeasing({
      broker: broker && {
        lease: (request) => Effect.tryPromise({ try: () => broker.lease(request), catch: brokerFailed }),
        readWeeklyReading: (accountId, force) =>
          Effect.tryPromise({ try: () => broker.readWeeklyReading(accountId, force), catch: brokerFailed }),
        readProviderWeeklyReading: (provider, force) =>
          Effect.tryPromise({
            try: () => broker.readProviderWeeklyReading(provider, force),
            catch: brokerFailed,
          }),
        readFastMode: (provider, accountId) =>
          Effect.tryPromise({ try: () => broker.readFastMode(provider, accountId), catch: brokerFailed }),
      },
      state: Effect.sync(state),
      record: (runId, event) => Effect.sync(() => transcripts.record(runId, event)),
    });
  }

  leaseAttempt(run: Run, exclude: string[], renewed: RunAccount | null = null) {
    return edgeRuntime.runPromise(this.#handle.leaseAttempt(run, exclude, renewed));
  }

  readWeeklyReading(
    runId: string,
    lease: AccountLease | null,
    provider: string,
    force: boolean
  ): Promise<WeeklyReading | null> {
    return edgeRuntime.runPromise(this.#handle.readWeeklyReading(runId, lease, provider, force));
  }

  readFastMode(lease: AccountLease | null, provider: string): Promise<FastModeAvailability> {
    return edgeRuntime.runPromise(this.#handle.readFastMode(lease, provider));
  }

  leaseSession(run: Run) {
    const lease = this.#handle.leaseSession(run);
    return lease && edgeRuntime.runPromise(lease);
  }
}
