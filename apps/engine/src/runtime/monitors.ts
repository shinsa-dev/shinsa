import type { StateClockOptions } from './clock.ts';
import type { Engine } from './engine.ts';
import { MONITOR_CLOCK_DEFAULTS, MonitorFireFailed } from './monitors/schema.ts';
import { makeMonitorClock } from './monitors/service.ts';
import { TickClock } from './tick-clock.ts';

export class MonitorClock extends TickClock<MonitorFireFailed> {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      {
        defaults: MONITOR_CLOCK_DEFAULTS,
        make: makeMonitorClock,
        fail: (message) => new MonitorFireFailed({ message }),
      },
      options
    );
  }
}
