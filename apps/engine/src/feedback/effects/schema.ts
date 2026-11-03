import type { DomainError, Feedback, ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectContext } from '../../runtime/engine/schema.ts';
import type { FeedbackDraft, FeedbackDraftFailed, FeedbackDraftInput } from '../draft/schema.ts';

export class FeedbackRecordFailed extends Schema.TaggedError<
  FeedbackRecordFailed,
  { readonly brand: unique symbol }
>()('FeedbackRecordFailed', { message: Schema.String }) {}

export type FeedbackEnvironment = (state: ShinsaState, entry: Feedback) => string[];

type FeedbackFailure = DomainError | FeedbackRecordFailed | FeedbackDraftFailed;

export interface FeedbackEffectsDefinition {
  readonly cwd: string;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    id?: string
  ) => Effect.Effect<unknown, DomainError | FeedbackRecordFailed>;
  readonly draft: (input: FeedbackDraftInput) => Effect.Effect<FeedbackDraft | null, FeedbackDraftFailed>;
  readonly environment: FeedbackEnvironment;
  readonly sync: Duration.Duration;
}

export interface FeedbackEffectsHandle {
  readonly draft: (feedbackId: string, context: EffectContext) => Effect.Effect<void, FeedbackFailure>;
  readonly file: (feedbackId: string, context: EffectContext) => Effect.Effect<void, FeedbackFailure>;
  readonly reportExhausted: (
    feedbackId: string,
    error: string,
    key: string
  ) => Effect.Effect<void, FeedbackFailure>;
  readonly recover: Effect.Effect<void, FeedbackFailure>;
  readonly syncIssues: (signal?: AbortSignal) => Effect.Effect<string | null, FeedbackFailure>;
}

export const NO_DRAFT = 'Your agent could not draft this issue. Write the note again to try once more.';

export const STOPPED_WHILE_FILING =
  'Shinsa stopped while it was opening this issue on GitHub. Check the issues on GitHub before you open it again.';

export const FEEDBACK_SYNC = Duration.minutes(10);
