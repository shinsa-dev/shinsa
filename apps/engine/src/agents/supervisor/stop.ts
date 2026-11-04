import { Duration, Effect, Fiber, Option } from 'effect';
import { describeError } from '../../log/index.ts';
import type { ActiveRun } from '../active/schema.ts';
import { RunHost } from './host/service.ts';
import { stopSession } from './session.ts';
import { RunWorld } from './world/service.ts';

function listEarlier(active: ReadonlyMap<string, ActiveRun>, taskId: string, except: string | undefined) {
  const earlier: [string, ActiveRun][] = [];
  for (const [id, run] of active) {
    if (id === except) break;
    if (run.taskId === taskId && !(except && run.delegated)) earlier.push([id, run]);
  }
  return earlier;
}

export const awaitDone = (runs: readonly [string, ActiveRun][]) =>
  Effect.promise(() => Promise.allSettled(runs.map(([, active]) => active.done))).pipe(Effect.asVoid);

export const settleWithin = <A, E>(work: Effect.Effect<A, E>, ms: number) =>
  Effect.forkDetach(work).pipe(
    Effect.flatMap((fiber) => Fiber.await(fiber).pipe(Effect.timeoutOption(Duration.millis(ms))))
  );

export const stopWithin = Effect.fn('RunSupervisor.stopWithin')(function* (
  runs: readonly [string, ActiveRun][],
  settled: Effect.Effect<void>
) {
  const host = yield* RunHost;
  const cancelled = Effect.forEach(
    runs,
    ([runId, active]) =>
      active.session ? stopSession(runId, active.session, '[Runs] Could not stop a run') : Effect.void,
    { concurrency: 'unbounded', discard: true }
  );
  const stopped = yield* Effect.all([cancelled, settled], { concurrency: 'unbounded' }).pipe(
    Effect.timeoutOption(Duration.millis(host.limits.stopMs))
  );
  if (Option.isSome(stopped)) return;
  for (const [runId, active] of runs) {
    if (host.active.get(runId) !== active) continue;
    yield* Effect.logWarning('[Runs] A run did not stop in time, so Shinsa stopped waiting for it').pipe(
      Effect.annotateLogs({ runId, taskId: active.taskId })
    );
    host.active.delete(runId);
    if (active.fiber) yield* Effect.forkDetach(Fiber.interrupt(active.fiber));
  }
});

export const quiesceTask = Effect.fn('RunSupervisor.quiesce')(function* (taskId: string, except?: string) {
  const host = yield* RunHost;
  const earlier = listEarlier(host.active, taskId, except);
  if (earlier.length === 0) return;
  const settled = awaitDone(earlier);
  const quiet = yield* settled.pipe(Effect.timeoutOption(Duration.millis(host.limits.quiesceMs)));
  if (Option.isSome(quiet)) return;
  yield* stopWithin(earlier, settled);
});

export const markInterrupted = Effect.fn('RunSupervisor.markInterrupted')(function* (
  runId: string,
  attemptId: string | null
) {
  const world = yield* RunWorld;
  const continuations = (yield* world.state).runs[runId]?.continuations?.length ?? 0;
  const attempt = attemptId ?? `${runId}:0:${continuations}`;
  yield* world
    .dispatch({ type: 'run.interrupt', runId, attemptId }, { id: `run.interrupt:${attempt}` })
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning('[Runs] Could not mark a run to resume after the restart').pipe(
          Effect.annotateLogs({ runId, error: describeError(error) })
        )
      )
    );
});
