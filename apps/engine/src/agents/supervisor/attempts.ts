import { RUN_AGENT_ROLE, resolveAgentModel, type RunAccount } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { resolveCapabilities } from '../providers/index.ts';
import type { TurnPlan } from '../turns/schema.ts';
import { LeaseFailed, type RecordedAttempt, type Turn } from './schema.ts';
import { RunWorld } from './world/service.ts';

export const resolveModel = Effect.fn('RunSupervisor.resolveModel')(function* ({ run, provider }: Turn) {
  if (provider.id === run.provider) return run.model;
  const state = yield* (yield* RunWorld).state;
  return resolveAgentModel(state.settings, RUN_AGENT_ROLE[run.role], provider.id);
});

export const leaseAttempt = Effect.fn('RunSupervisor.leaseAttempt')(function* ({
  provider,
  run,
  active,
}: Turn) {
  if (!resolveCapabilities(provider).accounts) return null;
  const { leasing } = yield* RunWorld;
  const renewing = active.renewing;
  active.renewing = null;
  return yield* Effect.tryPromise({
    try: () => leasing.leaseAttempt(run, [...active.rejected], renewing),
    catch: (error) => new LeaseFailed({ message: describeError(error) }),
  });
});

export const recordAttempt = Effect.fn('RunSupervisor.recordAttempt')(function* (turn: Turn, plan: TurnPlan) {
  const world = yield* RunWorld;
  const { run, active, provider } = turn;
  const recorded = (yield* world.state).runs[run.id]?.attempts?.length ?? 0;
  active.attempts = Math.max(recorded, active.attempts) + 1;
  const attemptId = `${run.id}:${active.attempts}`;
  active.attemptId = attemptId;
  active.leaseSpent = false;
  active.lease = yield* leaseAttempt(turn);
  const account: RunAccount | null = active.lease ? { id: active.lease.id, email: active.lease.email } : null;
  yield* world.dispatch(
    {
      type: 'run.attempt',
      runId: run.id,
      attemptId,
      provider: provider.id,
      model: yield* resolveModel(turn),
      resumed: plan.resume !== null,
      handoff: plan.record,
      cwd: turn.cwd,
      ...(account ? { account } : {}),
    },
    { id: `run.attempt:${attemptId}` }
  );
  if (plan.record) {
    const { reason, fromProvider, totalEntries, includedEntries } = plan.record;
    world.transcripts.record(run.id, {
      type: 'notice',
      notice: {
        kind: 'handoff',
        reason,
        fromProvider: world.providers.select(fromProvider)?.label ?? fromProvider,
        toProvider: provider.label,
        totalEntries,
        includedEntries,
      },
    });
  }
  const attempt: RecordedAttempt = { attemptId, account };
  return attempt;
});
