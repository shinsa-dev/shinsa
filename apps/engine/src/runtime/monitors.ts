import { DomainError, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from './clock.ts';
import { edgeRuntime } from './edge.ts';
import type { Engine } from './engine.ts';
import { MONITOR_CLOCK_DEFAULTS, MonitorFireFailed, type MonitorClockTick } from './monitors/schema.ts';
import { makeMonitorClock } from './monitors/service.ts';

export class MonitorClock extends StateClock {
  readonly #listTicks: (state: ShinsaState) => MonitorClockTick[];

  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(engine, MONITOR_CLOCK_DEFAULTS, options);
    this.#listTicks = edgeRuntime.runSync(
      makeMonitorClock({
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) =>
              error instanceof DomainError ? error : new MonitorFireFailed({ message: describeError(error) }),
          }),
        refuse: (id) => Effect.sync(() => this.refuse(id)),
      })
    );
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return this.#listTicks(state).map((tick) => ({
      id: tick.id,
      dueAt: tick.dueAt,
      fire: () => edgeRuntime.runPromise(tick.fire),
    }));
  }
}
