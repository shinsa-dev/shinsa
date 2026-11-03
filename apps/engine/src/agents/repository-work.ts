import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { OverlapRecordFailed, type RepositoryWorkHandle } from './repository-work/schema.ts';
import { makeRepositoryWork } from './repository-work/service.ts';

export class RepositoryWork {
  readonly #handle: RepositoryWorkHandle;

  constructor(engine: Engine) {
    this.#handle = edgeRuntime.runSync(
      makeRepositoryWork({
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) => new OverlapRecordFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
      })
    );
  }

  get handle() {
    return this.#handle;
  }

  describe(taskId: string, signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#handle.describe(taskId, signal));
  }

  recordOverlaps(taskId: string, planned: readonly string[], signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#handle.recordOverlaps(taskId, planned, signal));
  }
}
