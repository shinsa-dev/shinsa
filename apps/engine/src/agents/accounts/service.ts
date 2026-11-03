import type { Run, RunAccount, ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import type { AccountLease, AccountLeasingDefinition, AccountLeasingHandle } from './schema.ts';

export function makeAccountLeasing(definition: AccountLeasingDefinition): AccountLeasingHandle {
  const { broker } = definition;

  const selectPreviousAccount = (state: ShinsaState, taskId: string) => {
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
  };

  const leaseAttempt = Effect.fn('AccountLeasing.leaseAttempt')(function* (
    run: Run,
    exclude: string[],
    renewed: RunAccount | null
  ) {
    if (!broker) return null;
    const state = yield* definition.state;
    const previous = selectPreviousAccount(state, run.taskId);
    const lease = yield* broker.lease({
      runId: run.id,
      taskId: run.taskId,
      model: run.model,
      bound: renewed ?? run.account ?? state.tasks[run.taskId]?.account ?? null,
      previous,
      exclude,
    });
    if (lease && previous && previous.id !== lease.id) {
      yield* definition.record(run.id, {
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
  });

  const readWeeklyReading = Effect.fn('AccountLeasing.readWeeklyReading')(function* (
    runId: string,
    lease: AccountLease | null,
    provider: string,
    force: boolean
  ) {
    if (!broker) return null;
    const reading = lease
      ? broker.readWeeklyReading(lease.id, force)
      : broker.readProviderWeeklyReading(provider, force);
    return yield* reading.pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Runs] Could not read the weekly usage a run is charged against').pipe(
          Effect.annotateLogs({ runId, accountId: lease?.id ?? null, error: failure.message }),
          Effect.as(null)
        )
      )
    );
  });

  const readFastMode = (lease: AccountLease | null, provider: string) =>
    broker ? broker.readFastMode(provider, lease?.id ?? null) : Effect.succeed('available' as const);

  const leaseSession = (run: Run) => {
    const account = run.attempts?.at(-1)?.account ?? null;
    if (!account || !broker) return null;
    return broker.lease({
      runId: run.id,
      taskId: run.taskId,
      model: run.model,
      bound: account,
      previous: account,
      exclude: [],
    });
  };

  return { leaseAttempt, readWeeklyReading, readFastMode, leaseSession };
}
