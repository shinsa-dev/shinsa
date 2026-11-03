import { resolveQueue, serializeBriefing } from '@shinsa/core';
import { Clock, Effect, FiberHandle, Ref } from 'effect';
import { resolveBriefingAnswer } from './resolve.ts';
import type { BriefingsDefinition, BriefingsHandle } from './schema.ts';

export const makeBriefings = Effect.fn('Briefings.make')(function* (definition: BriefingsDefinition) {
  const scope = yield* Effect.scope;
  const stopped = yield* Ref.make(false);
  const waiting = yield* FiberHandle.make<void>();

  const write = Effect.gen(function* () {
    const state = yield* definition.state;
    const now = yield* Clock.currentTimeMillis;
    const queue = resolveQueue(state, now);
    const briefing = yield* resolveBriefingAnswer(state, queue, now, definition.ask);
    if (yield* Ref.get(stopped))
      return yield* Effect.logInfo(
        '[Briefing] Dropped a briefing that was written after the server stopped'
      ).pipe(Effect.annotateLogs({ seq: state.seq }));
    yield* definition.write(queue.focusProjectId, {
      text: serializeBriefing(briefing, yield* definition.state),
      briefing,
    });
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning('[Briefing] Could not write the briefing').pipe(
        Effect.annotateLogs({ error: failure.message })
      )
    )
  );

  const handle: BriefingsHandle = {
    schedule: Effect.gen(function* () {
      if (yield* Ref.get(stopped)) return;
      yield* FiberHandle.run(
        waiting,
        Effect.andThen(Effect.sleep(definition.debounce), Effect.forkIn(write, scope))
      );
    }),
    stop: Effect.andThen(Ref.set(stopped, true), FiberHandle.clear(waiting)),
  };
  return handle;
});
