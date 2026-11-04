import { resolveQueue, serializeBriefing } from '@shinsa/core';
import { Clock, Context, Effect, FiberHandle, Layer, Ref } from 'effect';
import { QuickCalls } from '../agents/quick/service.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { resolveBriefingAnswer } from './resolve.ts';
import { BriefingDebounce } from './schema.ts';

export class BriefingWriter extends Context.Service<
  BriefingWriter,
  {
    readonly schedule: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/briefing/BriefingWriter') {
  static readonly layer = Layer.effect(
    BriefingWriter,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const quick = yield* QuickCalls;
      const debounce = yield* BriefingDebounce;
      const scope = yield* Effect.scope;
      const stopped = yield* Ref.make(false);
      const waiting = yield* FiberHandle.make<void>();

      const write = Effect.gen(function* () {
        const state = yield* engine.state;
        const now = yield* Clock.currentTimeMillis;
        const queue = resolveQueue(state, now);
        const briefing = yield* resolveBriefingAnswer(state, queue, now, quick.write);
        if (yield* Ref.get(stopped))
          return yield* Effect.logInfo(
            '[Briefing] Dropped a briefing that was written after the server stopped'
          ).pipe(Effect.annotateLogs({ seq: state.seq }));
        yield* engine.writeBriefing(queue.focusProjectId, {
          text: serializeBriefing(briefing, yield* engine.state),
          briefing,
        });
      }).pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Briefing] Could not write the briefing').pipe(
            Effect.annotateLogs({ error: failure.message })
          )
        )
      );

      const schedule = Effect.gen(function* () {
        if (yield* Ref.get(stopped)) return;
        yield* FiberHandle.run(waiting, Effect.andThen(Effect.sleep(debounce), Effect.forkIn(write, scope)));
      });

      return BriefingWriter.of({
        schedule,
        stop: Effect.andThen(Ref.set(stopped, true), FiberHandle.clear(waiting)),
      });
    })
  );
}
