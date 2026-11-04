import type {
  DomainError,
  FastModeAvailability,
  Run,
  RunAccount,
  ShinsaState,
  WeeklyReading,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import { Transcripts } from '../transcripts/service.ts';
import { type AccountBrokerFailed, type AccountLease, AccountBroker } from './schema.ts';

export class AccountLeasing extends Context.Service<
  AccountLeasing,
  {
    leaseAttempt(
      run: Run,
      exclude: string[],
      renewed: RunAccount | null
    ): Effect.Effect<AccountLease | null, AccountBrokerFailed | DomainError>;
    readWeeklyReading(
      runId: string,
      lease: AccountLease | null,
      provider: string,
      force: boolean
    ): Effect.Effect<WeeklyReading | null>;
    readFastMode(
      lease: AccountLease | null,
      provider: string
    ): Effect.Effect<FastModeAvailability, AccountBrokerFailed>;
    leaseSession(run: Run): Effect.Effect<AccountLease | null, AccountBrokerFailed | DomainError>;
  }
>()('shinsa/engine/agents/accounts/AccountLeasing') {
  static readonly layer = Layer.effect(
    AccountLeasing,
    Effect.gen(function* () {
      const broker = yield* AccountBroker;
      const engine = yield* EngineCore;
      const transcripts = yield* Transcripts;

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
        const state = yield* engine.state;
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
          yield* transcripts.record(run.id, {
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
        broker
          ? broker.readFastMode(provider, lease?.id ?? null)
          : Effect.succeed<FastModeAvailability>('available');

      const leaseSession = (run: Run) => {
        const account = run.attempts?.at(-1)?.account ?? null;
        if (!account || !broker) return Effect.succeed(null);
        return broker.lease({
          runId: run.id,
          taskId: run.taskId,
          model: run.model,
          bound: account,
          previous: account,
          exclude: [],
        });
      };

      return AccountLeasing.of({ leaseAttempt, readWeeklyReading, readFastMode, leaseSession });
    })
  );
}
