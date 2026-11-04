import type { DomainError, ShinsaState } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { EngineStopped } from '../engine/schema.ts';
import type { EngineCore } from '../engine/service.ts';

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

export interface ClockTimings {
  readonly minDelay: Duration.Duration;
  readonly maxDelay: Duration.Duration;
}

export interface EngineClockTick {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<readonly unknown[] | null, DomainError | EngineStopped>;
}

export interface EngineClockDefinition {
  readonly area: string;
  readonly failure: string;
  readonly timings: ClockTimings;
  readonly list: (state: ShinsaState, engine: EngineCore['Service']) => readonly EngineClockTick[];
}

export interface EngineClock {
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly fireDue: Effect.Effect<void>;
}

export const MAX_CLOCK_DELAY = Duration.millis(2 ** 31 - 1);

export const CLOCK_FLOOR = Duration.millis(1);

export const CLOCK_MIN_DELAY = Duration.seconds(1);
