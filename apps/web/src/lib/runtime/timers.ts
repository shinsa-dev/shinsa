import { Effect, Schedule } from 'effect';
import { forkApp } from './app.ts';

function runReported(run: () => void) {
  return Effect.sync(run).pipe(
    Effect.catchDefect((defect) => Effect.sync(() => globalThis.reportError(defect)))
  );
}

export function scheduleAfter(delayMs: number, run: () => void) {
  const fiber = forkApp(Effect.delay(runReported(run), delayMs));
  return () => {
    fiber.interruptUnsafe();
  };
}

export function scheduleEvery(periodMs: number, run: () => void) {
  const fiber = forkApp(Effect.delay(Effect.repeat(runReported(run), Schedule.spaced(periodMs)), periodMs));
  return () => {
    fiber.interruptUnsafe();
  };
}
