import { Effect, Schedule } from 'effect';

const USAGE_POLL_SCHEDULE = Schedule.spaced('1 minute').pipe(Schedule.upTo({ times: 4 }));

export const watchUsage = Effect.fn('watchUsage')(function* <E, R>(readUsage: Effect.Effect<number, E, R>) {
  return yield* Effect.repeat(readUsage, USAGE_POLL_SCHEDULE);
});
