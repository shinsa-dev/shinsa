import { DomainError, type EngineRestartWhen } from '@shinsa/core';
import { Duration, Effect, Fiber, Ref } from 'effect';
import { isEngineBusy } from './busy.ts';
import type { EngineRestarterHandle, RestartControl, RestartDefinition } from './schema.ts';

export const makeEngineRestarter = Effect.fn('EngineRestarter.make')(function* (
  definition: RestartDefinition
) {
  const control = yield* Ref.make<RestartControl>({
    pending: null,
    deadlineAt: null,
    deadline: null,
    stopWatching: null,
    restarting: false,
  });

  const isBusy = Effect.map(definition.state, (state) => isEngineBusy(state, definition.isHeld));

  const endDrain = Effect.gen(function* () {
    const { deadline, stopWatching } = yield* Ref.get(control);
    yield* Ref.update(control, (current) => ({
      ...current,
      deadline: null,
      deadlineAt: null,
      stopWatching: null,
    }));
    if (deadline) yield* Fiber.interrupt(deadline);
    if (stopWatching) yield* Effect.sync(stopWatching);
  });

  const release = Effect.gen(function* () {
    const { pending } = yield* Ref.get(control);
    if (!pending) return;
    yield* Ref.update(control, (current) => ({ ...current, pending: null }));
    yield* definition.release;
  });

  const attempt = Effect.logInfo('[Engine] Restarting into the version the app carries').pipe(
    Effect.andThen(definition.restart),
    Effect.catch((failure) =>
      Ref.update(control, (current) => ({ ...current, restarting: false })).pipe(
        Effect.andThen(release),
        Effect.andThen(
          Effect.logError('[Engine] Could not restart').pipe(Effect.annotateLogs({ error: failure.message }))
        )
      )
    )
  );

  const restartSoon = Effect.gen(function* () {
    const started = yield* Ref.modify(control, (current) =>
      current.restarting ? [false, current] : [true, { ...current, restarting: true }]
    );
    if (!started) return;
    yield* endDrain;
    yield* definition.schedule(attempt);
  });

  const restartWhenIdle = Effect.gen(function* () {
    if (!(yield* isBusy)) yield* restartSoon;
  });

  const restartAtDeadline = Effect.sleep(definition.drain).pipe(
    Effect.andThen(Ref.update(control, (current) => ({ ...current, deadline: null }))),
    Effect.andThen(
      Effect.logInfo('[Engine] Agents still work past the restart deadline; their runs resume after it')
    ),
    Effect.andThen(restartSoon)
  );

  const drain = Effect.gen(function* () {
    if ((yield* Ref.get(control)).pending) return;
    const deadlineAt = (yield* definition.now) + Duration.toMillis(definition.drain);
    yield* Ref.update(control, (current) => ({ ...current, pending: 'idle' as const, deadlineAt }));
    yield* definition.hold(restartWhenIdle);
    const deadline = yield* Effect.forkDetach(restartAtDeadline);
    const stopWatching = yield* definition.watch(restartWhenIdle);
    yield* Ref.update(control, (current) => ({ ...current, deadline, stopWatching }));
  });

  const request = Effect.fn('EngineRestarter.request')(function* (when: EngineRestartWhen) {
    if (!(yield* definition.isService)) {
      return yield* new DomainError({
        code: 'restart_unsupported',
        message: 'Only a background engine restarts.',
      });
    }
    if (when === 'now' || !(yield* isBusy)) {
      yield* restartSoon;
      return { restarting: true };
    }
    yield* drain;
    return { restarting: false };
  });

  const handle: EngineRestarterHandle = {
    pending: Effect.map(Ref.get(control), (current) => current.pending),
    deadlineAt: Effect.map(Ref.get(control), (current) => current.deadlineAt),
    request,
  };
  return handle;
});
