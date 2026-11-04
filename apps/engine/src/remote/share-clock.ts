import type { StateClockOptions } from '../runtime/clock.ts';
import type { Engine } from '../runtime/engine.ts';
import { TickClock } from '../runtime/tick-clock.ts';
import { SHARE_CLOCK_DEFAULTS, ShareExpireFailed } from './share-clock/schema.ts';
import { makeShareClock } from './share-clock/service.ts';

export class ShareClock extends TickClock<ShareExpireFailed> {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      {
        defaults: SHARE_CLOCK_DEFAULTS,
        make: makeShareClock,
        fail: (message) => new ShareExpireFailed({ message }),
      },
      options
    );
  }
}
