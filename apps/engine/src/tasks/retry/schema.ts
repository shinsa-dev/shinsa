import { Context } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings, MAX_CLOCK_DELAY } from '../../runtime/clock/schema.ts';

export const TaskRetryTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/tasks/retry/TaskRetryTimings',
  {
    defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: MAX_CLOCK_DELAY }),
  }
);
