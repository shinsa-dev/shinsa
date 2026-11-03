import { Duration, Effect } from 'effect';
import { describeError } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { SILENCE_INTERVAL, SilenceRecordFailed, type SilenceWatchOptions } from './silence/schema.ts';
import { makeSilenceWatch } from './silence/service.ts';
import type { Transcripts } from './transcripts/index.ts';

export const watchSilence = Effect.fn('SilenceWatch.watchSilence')(function* (
  engine: Engine,
  transcripts: Transcripts,
  options: SilenceWatchOptions = {}
) {
  const handle = yield* makeSilenceWatch({
    now: Effect.sync(options.now ?? Date.now),
    state: Effect.sync(() => engine.state),
    lastOutputAt: (runId) => Effect.sync(() => transcripts.listEntries(runId).at(-1)?.at ?? null),
    dispatch: (command, id) =>
      Effect.tryPromise({
        try: () => engine.dispatch(command, { id }),
        catch: (error) => new SilenceRecordFailed({ message: describeError(error) }),
      }),
    interval: options.intervalMs === undefined ? SILENCE_INTERVAL : Duration.millis(options.intervalMs),
  });
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  yield* Effect.acquireRelease(
    Effect.sync(() => transcripts.subscribe((runId) => runFork(handle.heard(runId)))),
    (unsubscribe) => Effect.sync(unsubscribe)
  );
  yield* Effect.forkScoped(handle.watch);
  return handle;
});
