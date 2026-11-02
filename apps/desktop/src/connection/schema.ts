import { Duration, Schedule, Schema } from 'effect';

export const MISSES_BEFORE_WAITING = 3;

export const ConnectStep = Schema.Literals(['done', 'again']);

export type ConnectStep = typeof ConnectStep.Type;

export const RETRY_SCHEDULE = Schedule.spaced(Duration.seconds(2)).pipe(
  Schedule.setInputType<ConnectStep>(),
  Schedule.while(({ input }) => input === 'again')
);

export const WATCH_SCHEDULE = Schedule.fixed(Duration.seconds(5));
