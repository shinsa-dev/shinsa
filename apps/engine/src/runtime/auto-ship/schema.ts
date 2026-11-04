import { Context } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings, MAX_CLOCK_DELAY } from '../clock/schema.ts';

export const AutoShipClockTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/runtime/auto-ship/AutoShipClockTimings',
  {
    defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: MAX_CLOCK_DELAY }),
  }
);
