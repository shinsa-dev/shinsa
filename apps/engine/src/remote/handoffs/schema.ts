import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectAttempt } from '../../runtime/engine/schema.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';

export const CLAIM_FAILED = 'This machine could not hand the task to you. Try the link again in a moment.';

export interface HandoffEffects {
  link(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailed>;
  revoke(taskId: string, guestId: string | null): Effect.Effect<void, HandoffCallFailed>;
}

export class HandoffCommandFailed extends Schema.TaggedError<
  HandoffCommandFailed,
  { readonly brand: unique symbol }
>()('HandoffCommandFailed', { message: Schema.String }) {}

export class HandoffCallFailed extends Schema.TaggedError<
  HandoffCallFailed,
  { readonly brand: unique symbol }
>()('HandoffCallFailed', { message: Schema.String }) {}

export type HandoffsHandle = HandoffEffects;
