import { Duration, Effect } from 'effect';
import { describeError } from '../log/index.ts';
import type { EngineCore } from '../runtime/engine/service.ts';
import { SILENCE_INTERVAL, SilenceRecordFailed, type SilenceWatchOptions } from './silence/schema.ts';
import { makeSilenceWatch } from './silence/service.ts';
import type { Transcripts } from './transcripts/service.ts';

export const watchSilence = Effect.fn('SilenceWatch.watchSilence')(function* (
  engine: EngineCore['Service'],
  transcripts: Transcripts['Service'],
  options: SilenceWatchOptions = {}
) {
  const handle = yield* makeSilenceWatch({
    now: Effect.sync(options.now ?? Date.now),
    state: engine.state,
    lastOutputAt: (runId) =>
      Effect.map(transcripts.listEntries(runId), (entries) => entries.at(-1)?.at ?? null),
    dispatch: (command, id) =>
      engine.dispatch(command, { id }).pipe(
        Effect.asVoid,
        Effect.mapError((error) => new SilenceRecordFailed({ message: describeError(error) }))
      ),
    interval: options.intervalMs === undefined ? SILENCE_INTERVAL : Duration.millis(options.intervalMs),
  });
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const unsubscribe = yield* transcripts.subscribe((runId) => runFork(handle.heard(runId)));
  yield* Effect.addFinalizer(() => unsubscribe);
  yield* Effect.forkScoped(handle.watch);
  return handle;
});
