import { Clock, Duration, Effect, FiberHandle, Ref } from 'effect';
import type { RunClockHandle, RunClockState } from './schema.ts';

export const makeRunClock = Effect.fn('RunClock.make')(function* (
  limit: Duration.Duration,
  expire: Effect.Effect<void>
) {
  const state = yield* Ref.make<RunClockState>({
    remaining: Duration.toMillis(limit),
    startedAt: 0,
    pauses: 0,
    armed: false,
    stopped: false,
  });
  const clock = yield* Clock.Clock;
  const timer = yield* FiberHandle.make<void>();

  const arm = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (current.stopped) return;
    yield* Ref.set(state, { ...current, startedAt: yield* clock.currentTimeMillis, armed: true });
    yield* FiberHandle.run(
      timer,
      Effect.andThen(clock.sleep(Duration.millis(Math.max(0, current.remaining))), expire),
      { startImmediately: true }
    );
  });

  const pause = Effect.gen(function* () {
    const current = yield* Ref.updateAndGet(state, (previous) => ({
      ...previous,
      pauses: previous.pauses + 1,
    }));
    if (current.pauses > 1 || !current.armed) return;
    yield* FiberHandle.clear(timer);
    const now = yield* clock.currentTimeMillis;
    yield* Ref.set(state, {
      ...current,
      armed: false,
      remaining: current.remaining - (now - current.startedAt),
    });
  });

  const resume = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (current.pauses === 0) return;
    yield* Ref.set(state, { ...current, pauses: current.pauses - 1 });
    if (current.pauses === 1) yield* arm;
  });

  const stop = Effect.andThen(
    Ref.update(state, (current) => ({ ...current, stopped: true, armed: false })),
    FiberHandle.clear(timer)
  );

  const handle: RunClockHandle = { start: arm, pause, resume, stop };
  return handle;
});
