import type { DomainError, ShinsaCommand } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export class WatchdogFireFailed extends Schema.TaggedError<
  WatchdogFireFailed,
  { readonly brand: unique symbol }
>()('WatchdogFireFailed', { message: Schema.String }) {}

type WatchdogFireFailure = WatchdogFireFailed | DomainError;

export interface WatchdogClockDefinition {
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<readonly unknown[], WatchdogFireFailure>;
  readonly refuse: (id: string) => Effect.Effect<void>;
}

export interface WatchdogClockTick {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void, WatchdogFireFailure>;
}

export const WATCHDOG_CLOCK_DEFAULTS = {
  area: 'Watchdogs',
  failure: 'Could not run a watchdog check',
  minDelayMs: 1_000,
};
