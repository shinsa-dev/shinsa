import { describe, expect, test } from 'bun:test';
import { Clock, Duration, Effect, Fiber } from 'effect';
import { createDetachedClock } from '../../../../../src/agents/providers/claude/session/clock.ts';

describe('the clock a Claude session waits on', () => {
  test('tells the time as the clock under it does', async () => {
    const base = await Effect.runPromise(Clock.clockWith(Effect.succeed));
    const clock = createDetachedClock(base);
    expect(clock.currentTimeMillis).toBe(base.currentTimeMillis);
    expect(clock.currentTimeNanos).toBe(base.currentTimeNanos);
    expect(clock.monotonicTimeNanos).toBe(base.monotonicTimeNanos);
    expect(Math.abs(clock.currentTimeMillisUnsafe() - base.currentTimeMillisUnsafe())).toBeLessThan(1000);
    expect(clock.currentTimeNanosUnsafe()).toBeGreaterThan(0n);
    expect(clock.monotonicTimeNanosUnsafe()).toBeGreaterThan(0n);
  });

  test('sleeps on a timer that keeps no process alive, and an interrupt clears it', async () => {
    const clock = createDetachedClock(await Effect.runPromise(Clock.clockWith(Effect.succeed)));
    await Effect.runPromise(clock.sleep(Duration.millis(5)));
    const waiting = Effect.runFork(clock.sleep(Duration.hours(1)));
    await Effect.runPromise(Fiber.interrupt(waiting));
    expect(waiting.pollUnsafe()).toBeDefined();
  });
});
