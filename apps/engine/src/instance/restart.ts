import type { EngineRestartWhen, ShinsaState } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EngineActivity } from './install.ts';
import { countWorkingRuns } from './restart/busy.ts';
import {
  type EngineRestarterHandle,
  type EngineRestartOptions,
  type EngineRestartPending,
  EXIT_RESTART,
  RESTART_DELAY,
  RESTART_DRAIN,
  RestartFailed,
  type RestartSource,
  STOP_DEADLINE_MS,
  StopFailed,
  type StopOutcome,
  type RestartDrain,
} from './restart/schema.ts';
import { makeEngineRestarter } from './restart/service.ts';

export { isEngineBusy } from './restart/busy.ts';
export {
  type EngineRestartOptions,
  type EngineRestartPending,
  EXIT_RESTART,
  type RestartDrain,
  STOP_DEADLINE_MS,
  type StopOutcome,
} from './restart/schema.ts';

export class EngineRestarter {
  readonly #options: EngineRestartOptions;
  readonly #handle: EngineRestarterHandle;

  constructor(source: RestartSource, options: EngineRestartOptions) {
    this.#options = options;
    const { drain, schedule } = options;
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeEngineRestarter({
        state: Effect.sync(() => source.state),
        watch: (onChange) => Effect.sync(() => source.subscribe(() => edgeRuntime.runFork(onChange))),
        isService: Effect.tryPromise({
          try: options.isService,
          catch: (error) => new RestartFailed({ message: describeError(error) }),
        }),
        restart: Effect.asVoid(
          Effect.tryPromise({
            try: options.restart,
            catch: (error) => new RestartFailed({ message: describeError(error) }),
          })
        ),
        hold: (onHeld) => Effect.sync(() => drain?.holdNewRuns(() => edgeRuntime.runFork(onHeld))),
        release: Effect.sync(() => drain?.releaseHeldRuns()),
        isHeld: (runId) => this.isHeld(runId),
        drain: options.drainMs === undefined ? RESTART_DRAIN : Duration.millis(options.drainMs),
        now: Effect.sync(now),
        schedule: (run) =>
          schedule
            ? Effect.sync(() => schedule(() => edgeRuntime.runFork(run)))
            : Effect.asVoid(Effect.forkDetach(Effect.delay(run, RESTART_DELAY))),
      })
    );
  }

  get pending(): EngineRestartPending {
    return edgeRuntime.runSync(this.#handle.pending);
  }

  get deadlineAt() {
    return edgeRuntime.runSync(this.#handle.deadlineAt);
  }

  isHeld(runId: string) {
    return this.#options.drain?.isHeld(runId) ?? false;
  }

  request(when: EngineRestartWhen) {
    return edgeRuntime.runPromise(this.#handle.request(when));
  }
}

export function resolveEngineActivity(state: ShinsaState, restarter?: EngineRestarter): EngineActivity {
  const working = countWorkingRuns(state, (runId) => restarter?.isHeld(runId) ?? false);
  return {
    busy: working > 0,
    working,
    restart: restarter?.pending ?? null,
    restartBy: restarter?.deadlineAt ?? null,
  };
}

export const stopWithin = Effect.fn('EngineRestarter.stopWithin')(function* (
  stop: () => Promise<void>,
  deadlineMs: number = STOP_DEADLINE_MS
) {
  return yield* Effect.tryPromise({
    try: stop,
    catch: (error) => new StopFailed({ message: describeError(error) }),
  }).pipe(
    Effect.as<StopOutcome>('stopped'),
    Effect.catch((failure) =>
      Effect.logError('[Engine] Could not stop cleanly').pipe(
        Effect.annotateLogs({ error: failure.message }),
        Effect.as<StopOutcome>('failed')
      )
    ),
    Effect.timeoutOrElse({
      duration: Duration.millis(deadlineMs),
      orElse: () =>
        Effect.logError('[Engine] Did not stop in time, so it exits anyway').pipe(
          Effect.annotateLogs({ deadlineMs }),
          Effect.as<StopOutcome>('timed_out')
        ),
    })
  );
});

export interface ServiceRestart {
  byService: boolean;
  stop: () => Promise<void>;
  drain?: RestartDrain;
  exit?: (code: number) => void;
  deadlineMs?: number;
}

export function createServiceRestarter(source: RestartSource, service: ServiceRestart) {
  const exit = service.exit ?? ((code: number) => process.exit(code));
  const restart = stopWithin(service.stop, service.deadlineMs).pipe(
    Effect.andThen(Effect.sync(() => exit(EXIT_RESTART)))
  );
  return new EngineRestarter(source, {
    isService: () => Promise.resolve(service.byService),
    drain: service.drain,
    restart: () => edgeRuntime.runPromise(restart),
  });
}
