import { Duration, Effect, Fiber, Schedule } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';

export function startPolling(sample: () => Promise<void>, primeMs: number, intervalMs: number) {
  const polling = edgeRuntime.runFork(
    Effect.sleep(Duration.millis(primeMs)).pipe(
      Effect.andThen(Effect.promise(sample).pipe(Effect.repeat(Schedule.spaced(Duration.millis(intervalMs)))))
    )
  );
  return () => {
    edgeRuntime.runFork(Fiber.interrupt(polling));
  };
}
