import type { DomainError, ShinsaCommand, ShinsaState, Task } from '@shinsa/core';
import { Schema } from 'effect';
import type { Duration, Effect } from 'effect';
import type { ClassifierFailed, MessageClass } from '../schema.ts';

export interface InboxOptions {
  classifyTimeoutMs?: number;
}

export class InboxDispatchFailed extends Schema.TaggedError<
  InboxDispatchFailed,
  { readonly brand: unique symbol }
>()('InboxDispatchFailed', { message: Schema.String }) {}

export interface MessageInboxDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly classify: (task: Task, text: string) => Effect.Effect<MessageClass | null, ClassifierFailed>;
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<void, DomainError | InboxDispatchFailed>;
  readonly classifyTimeout: Duration.Duration;
}

export interface MessageInboxHandle {
  readonly sync: Effect.Effect<void>;
  readonly settle: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}
