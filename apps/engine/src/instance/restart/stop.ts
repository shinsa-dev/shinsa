import { Duration, Effect } from 'effect';
import { describeError } from '../../log/redact.ts';
import {
  EXIT_RESTART,
  type EngineRestartInput,
  type ServiceRestart,
  STOP_DEADLINE_MS,
  StopFailed,
  type StopOutcome,
} from './schema.ts';

export const stopWithin = Effect.fn('EngineRestarter.stopWithin')(function* (
  stop: Effect.Effect<void>,
  deadlineMs: number = STOP_DEADLINE_MS
) {
  return yield* stop.pipe(
    Effect.catchDefect((defect) => Effect.fail(new StopFailed({ message: describeError(defect) }))),
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

export function createServiceRestart(service: ServiceRestart): EngineRestartInput {
  const exit = service.exit ?? ((code: number) => process.exit(code));
  return {
    isService: Effect.succeed(service.byService),
    drain: service.drain,
    restart: stopWithin(service.stop, service.deadlineMs).pipe(
      Effect.andThen(Effect.sync(() => exit(EXIT_RESTART)))
    ),
  };
}
