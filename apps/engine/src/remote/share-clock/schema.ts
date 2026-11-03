import type { DomainError, ShinsaCommand } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export class ShareExpireFailed extends Schema.TaggedError<
  ShareExpireFailed,
  { readonly brand: unique symbol }
>()('ShareExpireFailed', { message: Schema.String }) {}

type ShareExpireFailure = ShareExpireFailed | DomainError;

export interface ShareClockDefinition {
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<readonly unknown[], ShareExpireFailure>;
  readonly refuse: (id: string) => Effect.Effect<void>;
}

export interface ShareClockTick {
  readonly id: string;
  readonly dueAt: number;
  readonly fire: Effect.Effect<void, ShareExpireFailure>;
}

export const SHARE_CLOCK_DEFAULTS = {
  area: 'Share',
  failure: 'Could not end a share that ran out',
  minDelayMs: 1_000,
};
