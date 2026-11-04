import { Clock, Effect } from 'effect';

export function createFixedClock(read: () => number): Clock.Clock {
  const real = Clock.Clock.defaultValue();
  return {
    currentTimeMillisUnsafe: read,
    currentTimeMillis: Effect.sync(read),
    currentTimeNanosUnsafe: () => BigInt(read()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(read()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: (duration) => real.sleep(duration),
  };
}
