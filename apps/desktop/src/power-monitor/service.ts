import { Context, type Effect, type Stream } from 'effect';
import type { PowerEvent } from '../away/schema.ts';

export class PowerMonitor extends Context.Service<
  PowerMonitor,
  {
    readonly idleMs: Effect.Effect<number>;
    readonly events: Stream.Stream<PowerEvent>;
  }
>()('shinsa/desktop/power-monitor/PowerMonitor') {}
