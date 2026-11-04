import { Cause, Console, Effect, Option } from 'effect';

export function reportFailure<A, E extends { readonly message: string }, R>(program: Effect.Effect<A, E, R>) {
  return program.pipe(
    Effect.tapCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.void;
      return Console.error(
        Option.match(Cause.findErrorOption(cause), {
          onNone: () => Cause.pretty(cause),
          onSome: (error) => error.message,
        })
      );
    })
  );
}
