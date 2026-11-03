import { DomainError, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from './clock.ts';
import { edgeRuntime } from './edge.ts';
import type { Engine } from './engine.ts';
import { WATCHDOG_CLOCK_DEFAULTS, WatchdogFireFailed, type WatchdogClockTick } from './watchdogs/schema.ts';
import { makeWatchdogClock } from './watchdogs/service.ts';

export class WatchdogClock extends StateClock {
  readonly #listTicks: (state: ShinsaState) => WatchdogClockTick[];

  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(engine, WATCHDOG_CLOCK_DEFAULTS, options);
    this.#listTicks = edgeRuntime.runSync(
      makeWatchdogClock({
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new WatchdogFireFailed({ message: describeError(error) }),
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
