import { Clock, Duration, Effect, Scope } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { type ClockTimers, NANOS_PER_MS, type RunClockHandle } from './clock/schema.ts';
import { makeRunClock } from './clock/service.ts';

export type { ClockTimers } from './clock/schema.ts';

function resolveTimersClock(timers: ClockTimers): Clock.Clock {
  const nanos = () => BigInt(timers.now()) * NANOS_PER_MS;
  return {
    currentTimeMillisUnsafe: timers.now,
    currentTimeMillis: Effect.sync(timers.now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const timer = timers.start(() => resume(Effect.void), Duration.toMillis(duration));
        return Effect.sync(() => timers.clear(timer));
      }),
  };
}

export class RunClock {
  readonly #handle: RunClockHandle;
  readonly #run: (effect: Effect.Effect<void>) => void;

  constructor(limitMs: number, onExpire: () => void, timers?: ClockTimers) {
    const clock = timers === undefined ? null : resolveTimersClock(timers);
    const withClock = <A, E>(effect: Effect.Effect<A, E>) =>
      clock === null ? effect : Effect.provideService(effect, Clock.Clock, clock);
    this.#run = (effect) => {
      edgeRuntime.runFork(withClock(effect));
    };
    this.#handle = edgeRuntime.runSync(
      withClock(
        makeRunClock(Duration.millis(limitMs), Effect.sync(onExpire)).pipe(
          Scope.provide(edgeRuntime.runSync(Scope.make()))
        )
      )
    );
  }

  start() {
    this.#run(this.#handle.start);
  }

  pause() {
    this.#run(this.#handle.pause);
  }

  resume() {
    this.#run(this.#handle.resume);
  }

  stop() {
    this.#run(this.#handle.stop);
  }
}
