import { DomainError, type EngineRestartWhen } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Exit, Fiber, Layer, Ref, Scope } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import type { EngineActivity } from '../install.ts';
import { isEngineBusy, resolveEngineActivity } from './busy.ts';
import {
  type EngineRestartInput,
  type EngineRestartPending,
  type RestartAnswer,
  type RestartControl,
  RestartDelay,
  RestartDrainWindow,
  type RestartFailed,
} from './schema.ts';

export class EngineRestarter extends Context.Service<
  EngineRestarter,
  {
    readonly pending: Effect.Effect<EngineRestartPending>;
    readonly deadlineAt: Effect.Effect<number | null>;
    readonly activity: Effect.Effect<EngineActivity>;
    request(when: EngineRestartWhen): Effect.Effect<RestartAnswer, DomainError | RestartFailed>;
  }
>()('shinsa/engine/instance/restart/EngineRestarter') {
  static readonly layer = (input: EngineRestartInput) =>
    Layer.effect(
      EngineRestarter,
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const window = yield* RestartDrainWindow;
        const delay = yield* RestartDelay;
        const scope = yield* Effect.scope;
        const context = yield* Effect.context<never>();
        const runFork = Effect.runForkWith(context);
        const control = yield* Ref.make<RestartControl>({
          pending: null,
          deadlineAt: null,
          deadline: null,
          watching: null,
          restarting: false,
        });

        const runSync = Effect.runSyncWith(context);
        const isHeld = (runId: string) => (input.drain ? runSync(input.drain.isHeld(runId)) : false);

        const isBusy = Effect.map(engine.state, (state) => isEngineBusy(state, isHeld));

        const endDrain = Effect.gen(function* () {
          const { deadline, watching } = yield* Ref.get(control);
          yield* Ref.update(control, (current) => ({
            ...current,
            deadline: null,
            deadlineAt: null,
            watching: null,
          }));
          if (deadline) yield* Fiber.interrupt(deadline);
          if (watching) yield* Scope.close(watching, Exit.void);
        });

        const release = Effect.gen(function* () {
          const { pending } = yield* Ref.get(control);
          if (!pending) return;
          yield* Ref.update(control, (current) => ({ ...current, pending: null }));
          if (input.drain) yield* input.drain.releaseHeldRuns;
        });

        const attempt = Effect.logInfo('[Engine] Restarting into the version the app carries').pipe(
          Effect.andThen(input.restart),
          Effect.catch((failure) =>
            Ref.update(control, (current) => ({ ...current, restarting: false })).pipe(
              Effect.andThen(release),
              Effect.andThen(
                Effect.logError('[Engine] Could not restart').pipe(
                  Effect.annotateLogs({ error: failure.message })
                )
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
          yield* Effect.forkDetach(Effect.delay(attempt, delay));
        });

        const restartWhenIdle = Effect.gen(function* () {
          if (!(yield* isBusy)) yield* restartSoon;
        });

        const restartAtDeadline = Effect.sleep(window).pipe(
          Effect.andThen(Ref.update(control, (current) => ({ ...current, deadline: null }))),
          Effect.andThen(
            Effect.logInfo('[Engine] Agents still work past the restart deadline; their runs resume after it')
          ),
          Effect.andThen(restartSoon)
        );

        const drain = Effect.gen(function* () {
          if ((yield* Ref.get(control)).pending) return;
          const deadlineAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(window);
          yield* Ref.update(control, (current) => ({ ...current, pending: 'idle' as const, deadlineAt }));
          if (input.drain) yield* input.drain.holdNewRuns(restartWhenIdle);
          const deadline = yield* Effect.forkIn(restartAtDeadline, scope);
          const watching = yield* Scope.fork(scope);
          yield* engine.observe(() => runFork(restartWhenIdle)).pipe(Scope.provide(watching));
          yield* Ref.update(control, (current) => ({ ...current, deadline, watching }));
        });

        const request = Effect.fn('EngineRestarter.request')(function* (when: EngineRestartWhen) {
          if (!(yield* input.isService)) {
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

        const activity = Effect.gen(function* () {
          const { pending, deadlineAt } = yield* Ref.get(control);
          return resolveEngineActivity(yield* engine.state, isHeld, pending, deadlineAt);
        });

        return EngineRestarter.of({
          pending: Effect.map(Ref.get(control), (current) => current.pending),
          deadlineAt: Effect.map(Ref.get(control), (current) => current.deadlineAt),
          activity,
          request,
        });
      })
    );
}
