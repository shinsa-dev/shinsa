import { DomainError, type ShinsaCommand, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { type ClockDefaults, type ClockEntry, StateClock, type StateClockOptions } from './clock.ts';
import { edgeRuntime } from './edge.ts';
import type { Engine } from './engine.ts';

interface TickClockDefinition<F> {
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<readonly unknown[], F | DomainError>;
  readonly refuse: (id: string) => Effect.Effect<void>;
}

export interface ClockTick<F> {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void, F | DomainError>;
}

export interface TickClockParts<F> {
  readonly defaults: ClockDefaults;
  readonly make: (
    definition: TickClockDefinition<F>
  ) => Effect.Effect<(state: ShinsaState) => ClockTick<F>[]>;
  readonly fail: (message: string) => F;
}

export abstract class TickClock<F> extends StateClock {
  readonly #listTicks: (state: ShinsaState) => ClockTick<F>[];

  constructor(engine: Engine, parts: TickClockParts<F>, options: StateClockOptions) {
    super(engine, parts.defaults, options);
    this.#listTicks = edgeRuntime.runSync(
      parts.make({
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) => (error instanceof DomainError ? error : parts.fail(describeError(error))),
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
