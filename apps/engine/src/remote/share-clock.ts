import { DomainError, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from '../runtime/clock.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { SHARE_CLOCK_DEFAULTS, ShareExpireFailed, type ShareClockTick } from './share-clock/schema.ts';
import { makeShareClock } from './share-clock/service.ts';

export class ShareClock extends StateClock {
  readonly #listTicks: (state: ShinsaState) => ShareClockTick[];

  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(engine, SHARE_CLOCK_DEFAULTS, options);
    this.#listTicks = edgeRuntime.runSync(
      makeShareClock({
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) =>
              error instanceof DomainError ? error : new ShareExpireFailed({ message: describeError(error) }),
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
