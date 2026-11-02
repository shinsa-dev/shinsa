import { Effect, Predicate } from 'effect';
import { StepFailed } from './schema.ts';

export function enterPromise<A>(step: () => Promise<A>) {
  return Effect.tryPromise({
    try: step,
    catch: (error) => new StepFailed({ message: Predicate.isError(error) ? error.message : String(error) }),
  });
}
