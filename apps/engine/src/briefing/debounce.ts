import { Duration, Effect, Fiber } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { DebouncedWrite } from './schema.ts';

export function createDebouncedWrite(delayMs: number, write: () => Promise<void>): DebouncedWrite {
  let waiting: Fiber.Fiber<void> | null = null;
  const cancel = () => {
    if (waiting) edgeRuntime.runFork(Fiber.interrupt(waiting));
    waiting = null;
  };
  const schedule = () => {
    cancel();
    waiting = edgeRuntime.runFork(
      Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            waiting = null;
          })
        ),
        Effect.andThen(Effect.tryPromise(write)),
        Effect.catch((failure) =>
          Effect.logWarning('[Briefing] Could not write the briefing').pipe(
            Effect.annotateLogs({ error: describeError(failure.cause) })
          )
        )
      )
    );
  };
  return { schedule, cancel };
}
