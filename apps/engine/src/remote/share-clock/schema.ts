import { Context } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings, MAX_CLOCK_DELAY } from '../../runtime/clock/schema.ts';

export const ShareClockTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/remote/share-clock/ShareClockTimings',
  {
    defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: MAX_CLOCK_DELAY }),
  }
);
