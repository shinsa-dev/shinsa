import { type Clock, Duration, Effect } from 'effect';

export function createDetachedClock(base: Clock.Clock): Clock.Clock {
  return {
    currentTimeMillisUnsafe: () => base.currentTimeMillisUnsafe(),
    currentTimeMillis: base.currentTimeMillis,
    currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe(),
    currentTimeNanos: base.currentTimeNanos,
    monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: base.monotonicTimeNanos,
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const timer = setTimeout(() => resume(Effect.void), Duration.toMillis(duration));
        timer.unref();
        return Effect.sync(() => clearTimeout(timer));
      }),
  };
}
