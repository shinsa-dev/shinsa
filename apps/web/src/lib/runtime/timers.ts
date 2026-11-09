import { Effect, Schedule } from 'effect';
import { forkApp } from './app.ts';

export function scheduleAfter(delayMs: number, run: () => void) {
  const fiber = forkApp(Effect.delay(Effect.sync(run), delayMs));
  return () => {
    fiber.interruptUnsafe();
  };
}

export function scheduleEvery(periodMs: number, run: () => void) {
  const fiber = forkApp(Effect.delay(Effect.repeat(Effect.sync(run), Schedule.spaced(periodMs)), periodMs));
  return () => {
    fiber.interruptUnsafe();
  };
}
