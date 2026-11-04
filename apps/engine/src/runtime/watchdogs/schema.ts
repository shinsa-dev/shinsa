import { Context } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings, MAX_CLOCK_DELAY } from '../clock/schema.ts';

export const WatchdogClockTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/runtime/watchdogs/WatchdogClockTimings',
  {
    defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: MAX_CLOCK_DELAY }),
  }
);
