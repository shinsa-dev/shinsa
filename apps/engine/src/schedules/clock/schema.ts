import { Context, Duration } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings } from '../../runtime/clock/schema.ts';

export const ScheduleClockTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/schedules/clock/ScheduleClockTimings',
  { defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: Duration.hours(1) }) }
);
