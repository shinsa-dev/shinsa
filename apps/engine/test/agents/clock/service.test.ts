import { describe, expect, test } from 'bun:test';
import { Duration, Effect, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { makeRunClock } from '../../../src/agents/clock/service.ts';

function run(effect: Effect.Effect<void, never, Scope.Scope>) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));
}

const createClock = Effect.fn('test.createClock')(function* (limitMs: number) {
  const state = { expired: false };
  const clock = yield* makeRunClock(
    Duration.millis(limitMs),
    Effect.sync(() => {
      state.expired = true;
    })
  );
  return { clock, state };
});

const advance = (ms: number) => TestClock.adjust(Duration.millis(ms));

describe('RunClock', () => {
  test('expires when the limit passes, not before', () =>
    run(
      Effect.gen(function* () {
        const { clock, state } = yield* createClock(10);
        yield* clock.start;
        yield* advance(9);
        expect(state.expired).toBe(false);
        yield* advance(1);
        expect(state.expired).toBe(true);
      })
    ));

  test('time spent paused does not count, and overlapping pauses resume only once all end', () =>
    run(
      Effect.gen(function* () {
        const { clock, state } = yield* createClock(40);
        yield* clock.start;
        yield* advance(10);
        yield* clock.pause;
        yield* clock.pause;
        yield* advance(60);
        yield* clock.resume;
        yield* advance(60);
        expect(state.expired).toBe(false);
        yield* clock.resume;
        yield* clock.resume;
        yield* advance(29);
        expect(state.expired).toBe(false);
        yield* advance(1);
        expect(state.expired).toBe(true);
      })
    ));

  test('a stopped clock never fires, even when resumed', () =>
    run(
      Effect.gen(function* () {
        const { clock, state } = yield* createClock(10);
        yield* clock.start;
        yield* clock.pause;
        yield* clock.stop;
        yield* clock.resume;
        yield* clock.stop;
        yield* advance(60);
        expect(state.expired).toBe(false);
      })
    ));

  test('stopping a running clock cancels its timer', () =>
    run(
      Effect.gen(function* () {
        const { clock, state } = yield* createClock(10);
        yield* clock.start;
        yield* clock.stop;
        yield* advance(60);
        expect(state.expired).toBe(false);
      })
    ));
});
