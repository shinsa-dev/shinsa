import { listLiveRuns, resolveContinuePrompt } from '@shinsa/core';
import { Cause, Effect, Fiber, FiberSet, Option } from 'effect';
import { describeError } from '../../log/index.ts';
import { isSteerable, stopActiveRun } from '../active/run.ts';
import type { Delivery } from '../delegations/schema.ts';
import { RunHost } from './host/service.ts';
import { executeRun } from './run.ts';
import { awaitDone, markInterrupted, settleWithin, stopWithin } from './stop.ts';
import { RunWorld } from './world/service.ts';

const forkRun = Effect.fn('RunSupervisor.forkRun')(function* (
  runId: string,
  override: string | null,
  delivery: Delivery | null
) {
  const host = yield* RunHost;
  return yield* FiberSet.run(host.fibers, executeRun(runId, override, delivery));
});

export const runToEnd = Effect.fn('RunSupervisor.runToEnd')(function* (
  runId: string,
  override: string | null,
  delivery: Delivery | null
) {
  const fiber = yield* forkRun(runId, override, delivery);
  yield* Fiber.join(fiber).pipe(
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause)))
  );
});

const startLogged = Effect.fn('RunSupervisor.startLogged')(function* (
  runId: string,
  override: string | null,
  failure: string
) {
  const host = yield* RunHost;
  const logged = executeRun(runId, override, null).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(failure).pipe(Effect.annotateLogs({ runId, error: describeError(Cause.squash(cause)) }))
    )
  );
  yield* FiberSet.run(host.fibers, logged);
});

export const cancelRun = Effect.fn('RunSupervisor.cancel')(function* (runId: string) {
  const host = yield* RunHost;
  const active = host.active.get(runId);
  if (!active) return;
  stopActiveRun(active);
  const closed = yield* settleWithin(host.scopes.closeRun(runId), host.limits.stopMs);
  if (Option.isSome(closed) || !active.fiber) return;
  yield* Effect.forkDetach(Fiber.interrupt(active.fiber));
});

export const steerRun = Effect.fn('RunSupervisor.steer')(function* (
  runId: string,
  text: string,
  cause?: string,
  from?: 'shinsa'
) {
  const world = yield* RunWorld;
  const host = yield* RunHost;
  const run = (yield* world.state).runs[runId];
  if (!run) return;
  const active = host.active.get(runId);
  if (run.endedAt === null && active && isSteerable(active)) {
    if (!active.session) {
      (from ? active.resteered : active.queued).push(text);
      return;
    }
    if (active.session.steer(text, from)) return;
  }
  yield* world.dispatch(
    { type: 'message.deliver', taskId: run.taskId, text },
    cause === undefined ? {} : { id: `${cause}:message.deliver` }
  );
});

export const releaseHeld = Effect.fn('RunSupervisor.releaseHeld')(function* () {
  const host = yield* RunHost;
  host.control.holding = null;
  const held = [...host.control.held];
  host.control.held.clear();
  for (const runId of held) {
    yield* startLogged(runId, null, '[Runs] Could not start a run held for the restart');
  }
});

export const shutdownRuns = Effect.fn('RunSupervisor.shutdown')(function* () {
  const host = yield* RunHost;
  host.control.shuttingDown = true;
  const compacting = host.compaction.stop();
  for (const runId of host.control.held) yield* markInterrupted(runId, null);
  host.control.held.clear();
  const live = [...host.active.entries()];
  for (const [runId, active] of live) yield* markInterrupted(runId, active.attemptId);
  for (const [, active] of live) stopActiveRun(active);
  const compacted = Effect.promise(() => Promise.allSettled([compacting]));
  yield* stopWithin(live, Effect.all([compacted, awaitDone(live)], { discard: true }));
  yield* settleWithin(host.scopes.closeAll, host.limits.stopMs);
});

const continueRun = Effect.fn('RunSupervisor.continueRun')(function* (runId: string, boot: string) {
  const world = yield* RunWorld;
  return yield* world.dispatch({ type: 'run.continue', runId }, { id: `${boot}:run.continue:${runId}` }).pipe(
    Effect.map((events) => events.some((event) => event.type === 'run.continued')),
    Effect.catch((error) =>
      Effect.logError('[Runs] Could not decide whether to resume a run').pipe(
        Effect.annotateLogs({ runId, error: describeError(error) }),
        Effect.as(false)
      )
    )
  );
});

export const recoverRuns = Effect.fn('RunSupervisor.recover')(function* () {
  const world = yield* RunWorld;
  const state = yield* world.state;
  const boot = `boot:${state.seq}`;
  const runs = listLiveRuns(state)
    .filter((run) => run.status !== 'queued')
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const run of runs) {
    if (!(yield* continueRun(run.id, boot))) continue;
    const started = (run.attempts?.length ?? 0) > 0 && run.sessionId !== null;
    yield* startLogged(run.id, started ? resolveContinuePrompt() : null, '[Runs] Resume failed');
  }
  yield* world.dispatch({ type: 'runs.dispatch' }, { id: `${boot}:runs.dispatch` });
  yield* world.dispatch({ type: 'delegations.recover' }, { id: `${boot}:delegations.recover` });
});
