import { Context } from 'effect';
import { CLOCK_MIN_DELAY, type ClockTimings, MAX_CLOCK_DELAY } from '../clock/schema.ts';

export const AutopilotClockTimings = Context.Reference<ClockTimings>(
  'shinsa/engine/runtime/autopilot/AutopilotClockTimings',
  {
    defaultValue: (): ClockTimings => ({ minDelay: CLOCK_MIN_DELAY, maxDelay: MAX_CLOCK_DELAY }),
  }
);
