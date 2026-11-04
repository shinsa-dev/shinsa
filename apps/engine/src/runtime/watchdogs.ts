import type { StateClockOptions } from './clock.ts';
import type { Engine } from './engine.ts';
import { TickClock } from './tick-clock.ts';
import { WATCHDOG_CLOCK_DEFAULTS, WatchdogFireFailed } from './watchdogs/schema.ts';
import { makeWatchdogClock } from './watchdogs/service.ts';

export class WatchdogClock extends TickClock<WatchdogFireFailed> {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      {
        defaults: WATCHDOG_CLOCK_DEFAULTS,
        make: makeWatchdogClock,
        fail: (message) => new WatchdogFireFailed({ message }),
      },
      options
    );
  }
}
