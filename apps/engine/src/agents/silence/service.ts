import { isRunWaiting, listLiveRuns, MINUTE_MS, type Run, SILENCE_MINUTES } from '@shinsa/core';
import { Effect, Ref } from 'effect';
import type { SilenceDefinition, SilenceWatchHandle } from './schema.ts';

export const makeSilenceWatch = Effect.fn('SilenceWatch.make')(function* (definition: SilenceDefinition) {
  const lastOutput = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const remember = (runId: string, at: number) =>
    Ref.update(lastOutput, (seen) => new Map(seen).set(runId, at));

  const heard = Effect.fn('SilenceWatch.heard')(function* (runId: string) {
    yield* remember(runId, yield* definition.now);
    const run = (yield* definition.state).runs[runId];
    const since = run?.silence?.since ?? null;
    if (since === null) return;
    yield* definition
      .dispatch({ type: 'run.silence', runId, since: null }, `run.silence:${runId}:${since}:heard`)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Silence] Could not record a quiet run').pipe(
            Effect.annotateLogs({ runId, error: failure.message })
          )
        )
      );
  });

  const resolveLast = Effect.fn('SilenceWatch.resolveLast')(function* (run: Run) {
    const seen = (yield* Ref.get(lastOutput)).get(run.id);
    if (seen !== undefined) return seen;
    const last = (yield* definition.lastOutputAt(run.id)) ?? run.startedAt;
    yield* remember(run.id, last);
    return last;
  });

  const check = Effect.gen(function* () {
    const now = yield* definition.now;
    const state = yield* definition.state;
    const live = new Set<string>();
    for (const run of listLiveRuns(state)) {
      live.add(run.id);
      if (run.status === 'queued' || isRunWaiting(state, run) || (run.silence && run.silence.since !== null))
        continue;
      const last = yield* resolveLast(run);
      if (now - last < SILENCE_MINUTES.suspicious * MINUTE_MS) continue;
      yield* definition.dispatch(
        { type: 'run.silence', runId: run.id, since: last },
        `run.silence:${run.id}:${last}`
      );
    }
    yield* Ref.update(lastOutput, (seen) => new Map([...seen].filter(([runId]) => live.has(runId))));
  });

  const watch = check.pipe(
    Effect.catch((failure) =>
      Effect.logWarning('[Silence] Could not check for quiet runs').pipe(
        Effect.annotateLogs({ error: failure.message })
      )
    ),
    Effect.delay(definition.interval),
    Effect.forever
  );

  const handle: SilenceWatchHandle = { heard, check, watch };
  return handle;
});
