import type { DomainError, ShinsaCommand, ShinsaState, TaskGuest } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectContext, Engine } from '../../runtime/engine.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';
import type { Remote } from '../index.ts';

export const CLAIM_FAILED = 'This machine could not hand the task to you. Try the link again in a moment.';

export interface HandoffEffects {
  link: (taskId: string, context: EffectContext) => Promise<void>;
  revoke: (taskId: string, guestId: string | null) => Promise<void>;
}

export interface HandoffsOptions {
  engine: Engine;
  remote: Remote;
}

export class HandoffCommandFailed extends Schema.TaggedError<
  HandoffCommandFailed,
  { readonly brand: unique symbol }
>()('HandoffCommandFailed', { message: Schema.String }) {}

export class HandoffCallFailed extends Schema.TaggedError<
  HandoffCallFailed,
  { readonly brand: unique symbol }
>()('HandoffCallFailed', { message: Schema.String }) {}

export interface HandoffsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    id?: string
  ) => Effect.Effect<void, DomainError | HandoffCommandFailed>;
  readonly createHandoff: (taskId: string) => Effect.Effect<string, DomainError | HandoffCallFailed>;
  readonly removeHandoff: (taskId: string, guestId: string | null) => Effect.Effect<void, HandoffCallFailed>;
}

export interface HandoffsHandle {
  readonly link: (taskId: string, context: EffectContext) => Effect.Effect<void, EffectFailed>;
  readonly revoke: (taskId: string, guestId: string | null) => Effect.Effect<void, HandoffCallFailed>;
  readonly claim: (taskId: string, guest: TaskGuest) => Effect.Effect<string | null>;
  readonly leave: (userIds: readonly string[]) => Effect.Effect<void>;
}
