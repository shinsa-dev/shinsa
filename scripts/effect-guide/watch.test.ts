import { describe, expect, test } from 'bun:test';
import { Clock, Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { watchUsage } from './watch.ts';

describe('a timer is a named Schedule, never setInterval', () => {
  test('usage is read now and once a minute four more times, on the test clock', async () => {
    const reads = await Effect.runPromise(
      Effect.gen(function* () {
        const times = yield* Ref.make<readonly number[]>([]);
        const read = Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.updateAndGet(times, (all) => [...all, now]).pipe(Effect.map((all) => all.length))
        );
        const fiber = yield* Effect.forkChild(watchUsage(read));
        yield* TestClock.adjust('10 minutes');
        yield* Fiber.join(fiber);
        return yield* Ref.get(times);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(reads).toEqual([0, 60_000, 120_000, 180_000, 240_000]);
  });
});
