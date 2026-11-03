import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';

export interface SilenceWatchOptions {
  now?: () => number;
  intervalMs?: number;
}

export class SilenceRecordFailed extends Schema.TaggedError<
  SilenceRecordFailed,
  { readonly brand: unique symbol }
>()('SilenceRecordFailed', {
  message: Schema.String,
}) {}

export interface SilenceDefinition {
  readonly now: Effect.Effect<number>;
  readonly state: Effect.Effect<ShinsaState>;
  readonly lastOutputAt: (runId: string) => Effect.Effect<number | null>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, SilenceRecordFailed>;
  readonly interval: Duration.Duration;
}

export interface SilenceWatchHandle {
  readonly heard: (runId: string) => Effect.Effect<void>;
  readonly check: Effect.Effect<void, SilenceRecordFailed>;
  readonly watch: Effect.Effect<never>;
}

export const SILENCE_INTERVAL = Duration.seconds(30);
