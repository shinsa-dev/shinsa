import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';

export interface StateClockOptions {
  now?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface ClockEntry {
  id: string;
  dueAt: number;
  fire: () => Promise<void>;
}

export interface ClockDefaults {
  area: string;
  failure: string;
  minDelayMs: number;
  maxDelayMs?: number;
}

export class ClockTickFailed extends Schema.TaggedError<ClockTickFailed, { readonly brand: unique symbol }>()(
  'ClockTickFailed',
  {
    message: Schema.String,
    refused: Schema.Boolean,
  }
) {}

export interface ClockTick {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void, ClockTickFailed>;
}

export interface ClockDefinition {
  readonly now: Effect.Effect<number>;
  readonly minDelay: Duration.Duration;
  readonly maxDelay: Duration.Duration;
  readonly list: Effect.Effect<readonly ClockTick[]>;
  readonly report: (failure: ClockTickFailed) => Effect.Effect<void>;
}

export interface StateClockHandle {
  readonly fireDue: Effect.Effect<void>;
  readonly refuse: (id: string) => Effect.Effect<void>;
  readonly arm: Effect.Effect<void>;
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

export const MAX_CLOCK_DELAY = Duration.millis(2 ** 31 - 1);

export const CLOCK_FLOOR = Duration.millis(1);
