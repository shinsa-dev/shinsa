import { Duration, Effect, FiberHandle, Option, Ref, Semaphore } from 'effect';
import { CLOCK_FLOOR, type ClockDefinition, type ClockTick, type StateClockHandle } from './schema.ts';

export const makeStateClock = Effect.fn('StateClock.make')(function* (definition: ClockDefinition) {
  const scope = yield* Effect.scope;
  const refused = yield* Ref.make<ReadonlySet<string>>(new Set());
  const active = yield* Ref.make(false);
  const armedAt = yield* Ref.make(Option.none<number>());
  const timer = yield* FiberHandle.make<void>();
  const firing = yield* Semaphore.make(1);

  const listLive = Effect.gen(function* () {
    const ticks = yield* definition.list;
    const listed = new Set(ticks.map((tick) => tick.id));
    const kept = yield* Ref.updateAndGet(refused, (ids) => new Set([...ids].filter((id) => listed.has(id))));
    return ticks.filter((tick) => !kept.has(tick.id));
  });

  const refuse = (id: string) => Ref.update(refused, (ids) => new Set(ids).add(id));

  const fireTick = (tick: ClockTick) =>
    tick.fire.pipe(
      Effect.catch((failure) =>
        Effect.andThen(failure.refused ? refuse(tick.id) : Effect.void, definition.report(failure))
      )
    );

  const fireOnce = Semaphore.withPermit(
    firing,
    Effect.gen(function* () {
      const now = yield* definition.now;
      for (const tick of yield* listLive) if (tick.dueAt <= now) yield* fireTick(tick);
    })
  );

  const disarm = Effect.andThen(Ref.set(armedAt, Option.none()), FiberHandle.clear(timer));

  const arm: Effect.Effect<void> = Effect.gen(function* () {
    if (!(yield* Ref.get(active))) return;
    const ticks = yield* listLive;
    if (ticks.length === 0) return yield* disarm;
    const dueAt = Math.min(...ticks.map((tick) => tick.dueAt));
    const current = yield* Ref.get(armedAt);
    if (Option.isSome(current) && current.value === dueAt) return;
    const wait = Duration.clamp(Duration.millis(dueAt - (yield* definition.now)), {
      minimum: Duration.max(definition.minDelay, CLOCK_FLOOR),
      maximum: definition.maxDelay,
    });
    yield* Ref.set(armedAt, Option.some(dueAt));
    yield* FiberHandle.run(
      timer,
      Effect.sleep(wait).pipe(
        Effect.andThen(Ref.set(armedAt, Option.none())),
        Effect.andThen(
          Effect.forkIn(
            Effect.suspend(() => fireDue),
            scope
          )
        )
      ),
      { startImmediately: true }
    );
  });

  const fireDue: Effect.Effect<void> = Effect.andThen(fireOnce, arm);

  const handle: StateClockHandle = {
    fireDue,
    refuse,
    arm,
    start: Effect.andThen(Ref.set(active, true), arm),
    stop: Effect.andThen(Ref.set(active, false), disarm),
  };
  return handle;
});
