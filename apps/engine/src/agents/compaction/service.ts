import { isDelegatedRun, isTaskSettled } from '@shinsa/core';
import { Duration, Effect, Fiber, FiberMap, Option, Ref } from 'effect';
import type { SessionContext } from '../providers/index.ts';
import {
  type IdleCompactionDefinition,
  type IdleCompactionHandle,
  type LastSession,
  type PendingCompaction,
  RESUMED_ROLES,
} from './schema.ts';
import { resolveCompactionWindow } from './window.ts';

export const makeIdleCompaction = Effect.fn('IdleCompaction.make')(function* (
  definition: IdleCompactionDefinition
) {
  const last = yield* Ref.make<ReadonlyMap<string, LastSession>>(new Map());
  const pending = yield* Ref.make<ReadonlyMap<string, PendingCompaction>>(new Map());
  const timers = yield* FiberMap.make<string>();
  const running = yield* FiberMap.make<string>();

  const without = <A>(map: ReadonlyMap<string, A>, key: string) => {
    const next = new Map(map);
    next.delete(key);
    return next;
  };

  const record = Effect.fn('IdleCompaction.record')(function* (
    runId: string,
    context: SessionContext | null
  ) {
    const run = (yield* definition.state).runs[runId];
    if (!run || !RESUMED_ROLES.has(run.role) || isDelegatedRun(run)) return;
    yield* Ref.update(last, (current) => new Map(current).set(run.taskId, { runId, context }));
  });

  const cancel = Effect.fn('IdleCompaction.cancel')(function* (taskId: string) {
    yield* FiberMap.remove(timers, taskId);
    yield* Ref.update(pending, (current) => without(current, taskId));
  });

  const compact = Effect.fn('IdleCompaction.compact')(function* (runId: string, sessionId: string) {
    yield* definition
      .compact(runId, sessionId)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Compaction] An idle session could not be compacted').pipe(
            Effect.annotateLogs({ runId, error: failure.message })
          )
        )
      );
  });

  const fire = Effect.fn('IdleCompaction.fire')(function* (taskId: string, runId: string) {
    const waiting = (yield* Ref.get(pending)).get(taskId);
    if (waiting?.runId !== runId) return;
    yield* Ref.update(pending, (current) => without(current, taskId));
    const window = resolveCompactionWindow(
      yield* definition.state,
      runId,
      waiting.context,
      yield* definition.now
    );
    if (!window) return;
    yield* Ref.update(last, (current) => without(current, taskId));
    yield* FiberMap.run(running, taskId, compact(window.runId, window.sessionId), { startImmediately: true });
  });

  const schedule = Effect.fn('IdleCompaction.schedule')(function* (taskId: string) {
    yield* cancel(taskId);
    const remembered = (yield* Ref.get(last)).get(taskId);
    if (!remembered) return;
    const state = yield* definition.state;
    const task = state.tasks[taskId];
    if (!task || isTaskSettled(task)) {
      yield* Ref.update(last, (current) => without(current, taskId));
      return;
    }
    const now = yield* definition.now;
    const window = resolveCompactionWindow(state, remembered.runId, remembered.context, now);
    if (!window || !remembered.context) return;
    yield* Ref.update(pending, (current) =>
      new Map(current).set(taskId, { runId: remembered.runId, context: remembered.context as SessionContext })
    );
    const delay = Duration.millis(Math.max(0, window.startAt - now));
    yield* FiberMap.run(timers, taskId, Effect.andThen(Effect.sleep(delay), fire(taskId, remembered.runId)), {
      startImmediately: true,
    });
  });

  const settle = Effect.fn('IdleCompaction.settle')(function* (taskId: string) {
    yield* cancel(taskId);
    const fiber = yield* FiberMap.get(running, taskId);
    if (Option.isSome(fiber)) yield* Fiber.await(fiber.value);
  });

  const stop = Effect.andThen(FiberMap.clear(timers), FiberMap.clear(running)).pipe(
    Effect.andThen(Ref.set(pending, new Map()))
  );

  const handle: IdleCompactionHandle = { record, schedule, cancel, settle, stop };
  return handle;
});
