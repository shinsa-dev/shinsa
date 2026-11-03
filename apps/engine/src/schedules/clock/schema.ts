import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export class ScheduleDispatchFailed extends Schema.TaggedError<
  ScheduleDispatchFailed,
  { readonly brand: unique symbol }
>()('ScheduleDispatchFailed', { message: Schema.String }) {}

export interface ScheduleClockDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly now: Effect.Effect<number>;
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<ShinsaEvent[], DomainError | ScheduleDispatchFailed>;
  readonly refuse: (entryId: string) => Effect.Effect<void>;
}

export interface ScheduleClockHandle {
  readonly fire: (
    scheduleId: string,
    entryId: string
  ) => Effect.Effect<void, DomainError | ScheduleDispatchFailed>;
}

export const SCHEDULE_CLOCK_DEFAULTS = {
  area: 'Schedules',
  failure: 'Could not run the due schedules',
  minDelayMs: 1_000,
  maxDelayMs: 60 * 60 * 1000,
};
