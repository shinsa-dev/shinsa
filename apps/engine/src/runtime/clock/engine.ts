import { Clock, Duration, Effect } from 'effect';
import { EngineCore } from '../engine/service.ts';
import {
  type ClockTick,
  ClockTickFailed,
  type EngineClock,
  type EngineClockDefinition,
  MAX_CLOCK_DELAY,
  type StateClockHandle,
} from './schema.ts';
import { makeStateClock } from './service.ts';

export const makeEngineClock = Effect.fn('EngineClock.make')(function* (definition: EngineClockDefinition) {
  const engine = yield* EngineCore;

  const list = Effect.map(engine.state, (state) =>
    definition.list(state, engine).map((tick): ClockTick => ({
      id: tick.id,
      dueAt: tick.dueAt,
      fire: tick.fire.pipe(
        Effect.mapError(
          (failure) =>
            new ClockTickFailed({ message: failure.message, refused: failure._tag === 'DomainError' })
        ),
        Effect.flatMap((events) =>
          events?.length === 0 ? Effect.suspend(() => clock.refuse(tick.id)) : Effect.void
        )
      ),
    }))
  );

  const clock: StateClockHandle = yield* makeStateClock({
    now: Clock.currentTimeMillis,
    minDelay: definition.timings.minDelay,
    maxDelay: Duration.min(definition.timings.maxDelay, MAX_CLOCK_DELAY),
    list,
    report: (failure) =>
      Effect.logWarning(`[${definition.area}] ${definition.failure}`).pipe(
        Effect.annotateLogs({ error: failure.message })
      ),
  });
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  yield* engine.observe(() => {
    runFork(clock.arm);
  });
  yield* Effect.addFinalizer(() => clock.stop);

  const handle: EngineClock = { start: clock.start, stop: clock.stop, fireDue: clock.fireDue };
  return handle;
});
