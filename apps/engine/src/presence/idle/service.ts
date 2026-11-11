import { NO_INPUT_YET, observeInput, resolvePresenceHour } from '@shinsa/core';
import { Clock, Context, Effect, Fiber, Layer, Ref, Schedule } from 'effect';
import { describeError } from '../../log/redact.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { MacIdle } from '../mac-idle/service.ts';
import { IDLE_POLL_INTERVAL, type IdleWatchState } from './schema.ts';

export class IdleWatch extends Context.Service<
  IdleWatch,
  {
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly poll: Effect.Effect<void>;
  }
>()('shinsa/engine/presence/idle/IdleWatch') {
  static readonly layer = Layer.effect(
    IdleWatch,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const mac = yield* MacIdle;
      const watch = yield* Ref.make<IdleWatchState>({ away: NO_INPUT_YET, sentHour: null });
      const running = yield* Ref.make<Fiber.Fiber<unknown> | null>(null);

      const poll = Effect.gen(function* () {
        const idle = yield* mac.idleMs;
        if (idle === null) return;
        const now = yield* Clock.currentTimeMillis;
        const current = yield* Ref.get(watch);
        const step = observeInput(current.away, now, idle);
        const inputAt = step.state.lastInput ?? now - idle;
        const hour = resolvePresenceHour(inputAt);
        yield* Ref.set(watch, { away: step.state, sentHour: current.sentHour });
        if (!step.span && hour === current.sentHour) return;
        yield* engine.dispatch({ type: 'idle.record', inputAt, away: step.span }).pipe(
          Effect.andThen(Ref.update(watch, (state) => ({ ...state, sentHour: hour }))),
          Effect.catch((failure) =>
            Effect.logWarning('[Presence] Could not record when you used your Mac').pipe(
              Effect.annotateLogs({ error: describeError(failure) })
            )
          )
        );
      });

      const start = Effect.gen(function* () {
        if (yield* Ref.get(running)) return;
        const fiber = yield* Effect.forkDetach(Effect.repeat(poll, Schedule.spaced(IDLE_POLL_INTERVAL)));
        yield* Ref.set(running, fiber);
      });
      const stop = Effect.gen(function* () {
        const fiber = yield* Ref.getAndSet(running, null);
        if (fiber) yield* Fiber.interrupt(fiber);
      });
      yield* Effect.addFinalizer(() => stop);
      return IdleWatch.of({ start, stop, poll });
    })
  );
}
