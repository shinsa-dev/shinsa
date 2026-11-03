import { DomainError, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { type ClockEntry, StateClock, type StateClockOptions } from '../runtime/clock.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { SCHEDULE_CLOCK_DEFAULTS, ScheduleDispatchFailed, type ScheduleClockHandle } from './clock/schema.ts';
import { createScheduleClock } from './clock/service.ts';

export class ScheduleClock extends StateClock {
  readonly #handle: ScheduleClockHandle;

  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(engine, SCHEDULE_CLOCK_DEFAULTS, options);
    this.#handle = createScheduleClock({
      state: Effect.sync(() => this.engine.state),
      now: Effect.sync(() => this.now()),
      dispatch: (command, id) =>
        Effect.tryPromise({
          try: () => this.engine.dispatch(command, { id }),
          catch: (error) =>
            error instanceof DomainError
              ? error
              : new ScheduleDispatchFailed({ message: describeError(error) }),
        }),
      refuse: (entryId) => Effect.sync(() => this.refuse(entryId)),
    });
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return Object.values(state.schedules).flatMap((schedule) => {
      if (!schedule.enabled || schedule.nextRunAt === null) return [];
      const id = `schedule:${schedule.id}:${schedule.nextRunAt}:${schedule.updatedAt}`;
      return [
        {
          id,
          dueAt: schedule.nextRunAt,
          fire: () => edgeRuntime.runPromise(this.#handle.fire(schedule.id, id)),
        },
      ];
    });
  }
}
