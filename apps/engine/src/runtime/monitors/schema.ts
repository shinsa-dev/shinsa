import type { DomainError, ShinsaCommand } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export class MonitorFireFailed extends Schema.TaggedError<
  MonitorFireFailed,
  { readonly brand: unique symbol }
>()('MonitorFireFailed', { message: Schema.String }) {}

type MonitorFireFailure = MonitorFireFailed | DomainError;

export interface MonitorClockDefinition {
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<readonly unknown[], MonitorFireFailure>;
  readonly refuse: (id: string) => Effect.Effect<void>;
}

export interface MonitorClockTick {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void, MonitorFireFailure>;
}

export const MONITOR_CLOCK_DEFAULTS = {
  area: 'Monitors',
  failure: 'Could not wake a waiting task',
  minDelayMs: 1_000,
};
