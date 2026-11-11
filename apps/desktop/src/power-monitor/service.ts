import type { PowerEvent } from '@shinsa/core';
import { Context, type Effect, type Stream } from 'effect';

export class PowerMonitor extends Context.Service<
  PowerMonitor,
  {
    readonly idleMs: Effect.Effect<number>;
    readonly events: Stream.Stream<PowerEvent>;
  }
>()('shinsa/desktop/power-monitor/PowerMonitor') {}
