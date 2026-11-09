import {
  type DelegatedRun,
  DomainError,
  isDelegatedRun,
  isReadOnlyRun,
  OWNER_SIGNED_OUT_CODE,
  type Repo,
  type RunFailure,
} from '@shinsa/core';
import { Cause, Clock, Duration, Effect, FiberSet, Ref } from 'effect';
import { describeError } from '../../log/index.ts';
import type { RejectionVerdict } from '../accounts/schema.ts';
import { carryUndelivered, stopActiveRun } from '../active/run.ts';
import type { ActiveRun } from '../active/schema.ts';
import { RunClockTime } from '../clock/schema.ts';
import type { RunClockHandle } from '../clock/schema.ts';
import { makeRunClock } from '../clock/service.ts';
import { resolveDelegatedReply } from '../delegations/delivery.ts';
import { type AgentSessionResult, resolveCapabilities } from '../providers/index.ts';
import { resolveRestorePlan, resolveTurnPlan } from '../turns/plan.ts';
import type { TurnPlan } from '../turns/schema.ts';
import { RunHost } from './host/service.ts';
import { isOverloadRetry, waitForOverload } from './overload.ts';
import {
  type DriveAttempt,
  type DriveStep,
  DRIVE_TIMED_OUT,
  LeaseFailed,
  type Turn,
  UNGUARDED,
  UNREADONLY,
} from './schema.ts';
import { attemptTurn, recordSessionLost, resolveTurnContext, stopSession } from './session.ts';
import { prepareIsolation } from './workspace.ts';
import { RunWorld } from './world/service.ts';

function createFailure(failureClass: RunFailure['class'], message: string, code: string): RunFailure {
  return { class: failureClass, message, code, retryable: null, resetAt: null };
}

function failSetup(message: string, code: string): AgentSessionResult {
  return { outcome: 'failed', summary: message, failure: createFailure('setup_failed', message, code) };
}

function resolveDriveFailure(error: unknown): AgentSessionResult {
  const summary = describeError(error);
  if (error instanceof LeaseFailed && error.code === OWNER_SIGNED_OUT_CODE) {
    return { outcome: 'failed', summary, failure: createFailure('auth', summary, error.code) };
  }
  if (error instanceof DomainError && error.code === 'handoff_too_large') {
    return { outcome: 'failed', summary, failure: createFailure('context_window_full', summary, error.code) };
  }
  return { outcome: 'failed', summary };
}

function retryRenewed(active: ActiveRun, accountId: string) {
  active.renewed.push(accountId);
  active.rejected = active.rejected.filter((id) => id !== accountId);
  active.renewing = { id: accountId, email: active.lease?.email ?? null };
}

const markLeaseSpent = Effect.fn('RunSupervisor.markLeaseSpent')(function* (
  except: string,
  accountId: string
) {
  const host = yield* RunHost;
  for (const [runId, active] of host.active) {
    if (runId === except || active.lease?.id !== accountId || active.leaseSpent) continue;
    active.leaseSpent = true;
    yield* Effect.logInfo(
      '[Runs] Another run hit the usage limit of this run’s account; its next turn moves'
    ).pipe(Effect.annotateLogs({ runId, accountId }));
    yield* FiberSet.run(host.fibers, host.questions.releaseWaiting(runId));
  }
});

const reviewAttempt = Effect.fn('RunSupervisor.review')(function* (
  turn: Turn,
  attemptId: string,
  result: AgentSessionResult
) {
  const host = yield* RunHost;
  const { active, run } = turn;
  const handler = host.hooks.onRejection;
  const failure = result.failure;
  const skip: RejectionVerdict = { retry: false };
  if (!handler || result.outcome !== 'failed' || !failure || active.stopping) return skip;
  const accountId = active.lease?.id ?? null;
  if (accountId) active.rejected.push(accountId);
  if (accountId && failure.class === 'usage_limit') yield* markLeaseSpent(run.id, accountId);
  const rejection = {
    runId: run.id,
    taskId: run.taskId,
    provider: turn.provider.id,
    attemptId,
    accountId,
    tried: [...active.rejected],
    renewed: [...active.renewed],
    failure,
  };
  return yield* handler(rejection).pipe(
    Effect.catchDefect((error) =>
      Effect.logWarning('[Runs] The rejection handler failed; the run ends').pipe(
        Effect.annotateLogs({ runId: rejection.runId, error: describeError(error) }),
        Effect.as(skip)
      )
    )
  );
});

const restoreLost = Effect.fn('RunSupervisor.restoreLost')(function* (
  turn: Turn,
  plan: TurnPlan,
  sessionId: string
) {
  if (!plan.fork) yield* recordSessionLost(turn.run.id, sessionId);
  const context = yield* resolveTurnContext(turn);
  return yield* resolveRestorePlan(context, plan, sessionId);
});

interface RunWatch {
  readonly clock: RunClockHandle;
  timedOut: boolean;
}

const TIMED_OUT: AgentSessionResult = { outcome: 'failed', summary: DRIVE_TIMED_OUT };

const startRunWatch = Effect.fn('RunSupervisor.startRunWatch')(function* (turn: Turn) {
  const { active } = turn;
  const host = yield* RunHost;
  const fork = yield* FiberSet.runtime(host.fibers)<RunWorld | RunHost>();
  const onTimeout = Effect.sync(() => {
    watch.timedOut = true;
    const session = active.session;
    if (session) {
      stopActiveRun(active);
      fork(stopSession(turn.run.id, session, '[Runs] Could not stop a run past its time limit'));
    }
    active.wake?.();
  });
  const time = yield* RunClockTime;
  const make = makeRunClock(Duration.millis(host.limits.maxRunMs), onTimeout);
  const watch: RunWatch = {
    clock: yield* time ? Effect.provideService(make, Clock.Clock, time) : make,
    timedOut: false,
  };
  active.clock = watch.clock;
  return watch;
});

const retryOverload = Effect.fn('RunSupervisor.retryOverload')(function* (
  turn: Turn,
  result: AgentSessionResult,
  watch: RunWatch
) {
  const { active } = turn;
  yield* waitForOverload(turn, result.failure?.message ?? '');
  if (watch.timedOut) return TIMED_OUT;
  if (active.stopping) {
    const cancelled: AgentSessionResult = {
      outcome: 'cancelled',
      summary: null,
      undelivered: result.undelivered,
    };
    return cancelled;
  }
  carryUndelivered(active, result.undelivered);
  return null;
});

const resolveDriveStep = Effect.fn('RunSupervisor.resolveDriveStep')(function* (
  turn: Turn,
  { plan, restored }: DriveAttempt,
  watch: RunWatch
) {
  const host = yield* RunHost;
  const { active } = turn;
  const { attemptId, result } = yield* attemptTurn(turn, plan);
  if (watch.timedOut) return { done: TIMED_OUT } satisfies DriveStep;
  const lost = result.failure?.class === 'session_lost' && !restored ? plan.resume : null;
  if (lost !== null) {
    carryUndelivered(active, result.undelivered);
    const next: DriveStep = { plan: yield* restoreLost(turn, plan, lost), restored: true };
    return next;
  }
  if (yield* isOverloadRetry(active, result, (yield* Ref.get(host.control)).shuttingDown)) {
    const stopped = yield* retryOverload(turn, result, watch);
    const next: DriveStep = stopped ? { done: stopped } : { plan, restored };
    return next;
  }
  const verdict = yield* reviewAttempt(turn, attemptId, result);
  if (!verdict.retry) {
    const ended: DriveStep = { done: verdict.failure ? { ...result, failure: verdict.failure } : result };
    return ended;
  }
  if (verdict.renewed) retryRenewed(active, verdict.renewed);
  carryUndelivered(active, result.undelivered);
  const next: DriveStep = { plan, restored };
  return next;
});

const driveTurn = Effect.fn('RunSupervisor.drive')(function* (turn: Turn) {
  const world = yield* RunWorld;
  const { run, provider } = turn;
  if (!resolveCapabilities(provider).approvals) return failSetup(UNGUARDED, 'unguarded');
  const watch = yield* startRunWatch(turn);
  const loop = Effect.gen(function* () {
    yield* world.transcripts.record(run.id, { type: 'status', status: 'started', outcome: null });
    yield* watch.clock.start;
    const context = yield* resolveTurnContext(turn);
    let step: DriveStep = { plan: yield* resolveTurnPlan(context), restored: false };
    while (!('done' in step)) step = yield* resolveDriveStep(turn, step, watch);
    return step.done;
  });
  return yield* loop.pipe(
    Effect.catchCause((cause) => Effect.succeed(resolveDriveFailure(Cause.squash(cause)))),
    Effect.ensuring(watch.clock.stop)
  );
}, Effect.scoped);

export const prepareAndDrive = Effect.fn('RunSupervisor.prepareAndDrive')(function* (
  turn: Turn,
  repo: Repo | null
) {
  const { run, provider } = turn;
  if (isReadOnlyRun(run) && !resolveCapabilities(provider).planning.readOnly) {
    return failSetup(UNREADONLY, 'read_only');
  }
  if (!isDelegatedRun(run)) return yield* driveTurn(turn);
  const isolation = yield* prepareIsolation(run, repo).pipe(
    Effect.as(null),
    Effect.catchTag('IsolationFailed', (failure) => Effect.succeed(failure.message))
  );
  if (isolation !== null) return failSetup(isolation, 'isolation');
  return yield* driveTurn(turn);
});

export const resolveDelegatedResult = Effect.fn('RunSupervisor.resolveDelegatedResult')(function* (
  run: DelegatedRun,
  cwd: string,
  result: AgentSessionResult
) {
  if (result.outcome !== 'completed') return result;
  const world = yield* RunWorld;
  const reply = resolveDelegatedReply(yield* world.transcripts.listEntries(run.id)) ?? result.summary;
  if (run.delegation.isolation !== 'worktree') return { ...result, summary: reply };
  const changed = yield* world.checkout.describeIsolated(cwd);
  if (!changed) return { ...result, summary: reply };
  const files = `${changed} ${changed === 1 ? 'file' : 'files'}`;
  const note = `Its changes are not committed: ${files} in its own checkout at \`${cwd}\`. Bring over what you need, for example with \`git -C ${cwd} diff | git apply\`.`;
  return { ...result, summary: reply ? `${reply}\n\n${note}` : note };
});
