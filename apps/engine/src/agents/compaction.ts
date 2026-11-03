import type { ShinsaState } from '@shinsa/core';
import { Effect, Fiber, Scope } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  CompactionFailed,
  type IdleCompactionHandle,
  type IdleCompactionOptions,
} from './compaction/schema.ts';
import { makeIdleCompaction } from './compaction/service.ts';
import type { SessionContext } from './providers/index.ts';

export { COMPACTION_NEAR_LIMIT, type IdleCompactionOptions } from './compaction/schema.ts';
export { resolveCompactionWindow } from './compaction/window.ts';

type CompactionStarter = (runId: string, sessionId: string, signal: AbortSignal) => Promise<void>;

const runCompaction = Effect.fn('IdleCompaction.run')(function* (
  compact: CompactionStarter,
  runId: string,
  sessionId: string
) {
  const controller = new AbortController();
  const child = yield* Effect.forkChild(
    Effect.uninterruptible(
      Effect.tryPromise({
        try: () => compact(runId, sessionId, controller.signal),
        catch: (error) => new CompactionFailed({ message: describeError(error) }),
      })
    )
  );
  return yield* Fiber.join(child).pipe(
    Effect.onInterrupt(() =>
      Effect.andThen(
        Effect.sync(() => controller.abort()),
        Fiber.await(child)
      )
    )
  );
});

export class IdleCompaction {
  readonly #handle: IdleCompactionHandle;

  constructor(state: () => ShinsaState, compact: CompactionStarter, options: IdleCompactionOptions = {}) {
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeIdleCompaction({
        state: Effect.sync(state),
        now: Effect.sync(now),
        compact: (runId, sessionId) => runCompaction(compact, runId, sessionId),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  record(runId: string, context: SessionContext | null) {
    edgeRuntime.runSync(this.#handle.record(runId, context));
  }

  schedule(taskId: string) {
    edgeRuntime.runSync(this.#handle.schedule(taskId));
  }

  cancel(taskId: string) {
    edgeRuntime.runSync(this.#handle.cancel(taskId));
  }

  settle(taskId: string) {
    return edgeRuntime.runPromise(this.#handle.settle(taskId));
  }

  stop() {
    return edgeRuntime.runPromise(this.#handle.stop);
  }
}
