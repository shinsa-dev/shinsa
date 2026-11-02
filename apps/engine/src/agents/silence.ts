import { Duration, Effect, Fiber } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import {
  SILENCE_INTERVAL,
  SilenceRecordFailed,
  type SilenceWatchHandle,
  type SilenceWatchOptions,
} from './silence/schema.ts';
import { makeSilenceWatch } from './silence/service.ts';
import type { Transcripts } from './transcripts/index.ts';

export class SilenceWatch {
  readonly #transcripts: Transcripts;
  readonly #handle: SilenceWatchHandle;
  #fiber: Fiber.Fiber<never> | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(engine: Engine, transcripts: Transcripts, options: SilenceWatchOptions = {}) {
    this.#transcripts = transcripts;
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeSilenceWatch({
        now: Effect.sync(now),
        state: Effect.sync(() => engine.state),
        lastOutputAt: (runId) => Effect.sync(() => transcripts.listEntries(runId).at(-1)?.at ?? null),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) => new SilenceRecordFailed({ message: describeError(error) }),
          }),
        interval: options.intervalMs === undefined ? SILENCE_INTERVAL : Duration.millis(options.intervalMs),
      })
    );
  }

  start() {
    this.#unsubscribe ??= this.#transcripts.subscribe((runId) => {
      edgeRuntime.runFork(this.#handle.heard(runId));
    });
    this.#fiber ??= edgeRuntime.runFork(this.#handle.watch);
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#fiber) edgeRuntime.runFork(Fiber.interrupt(this.#fiber));
    this.#fiber = null;
  }

  check() {
    return edgeRuntime.runPromise(this.#handle.check);
  }
}
