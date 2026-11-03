import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { StateClockOptions } from '../../runtime/clock.ts';

export interface UsageResumeClockOptions extends StateClockOptions {
  graceMs?: number;
  retryMs?: number;
}

export class UsageResumeFailed extends Schema.TaggedError<
  UsageResumeFailed,
  { readonly brand: unique symbol }
>()('UsageResumeFailed', { message: Schema.String }) {}

export interface UsageResumeDefinition {
  readonly graceMs: number;
  readonly retryMs: number;
  readonly now: Effect.Effect<number>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, UsageResumeFailed>;
}

export interface UsageResumeEntry {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void>;
}

export interface UsageResumeHandle {
  readonly listEntries: (state: ShinsaState) => Effect.Effect<UsageResumeEntry[]>;
}
