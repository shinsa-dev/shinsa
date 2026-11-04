import type { DomainError, Feedback, ShinsaState } from '@shinsa/core';
import { Context, Duration } from 'effect';
import type { EngineStopped } from '../../runtime/engine/schema.ts';

type FeedbackEnvironment = (state: ShinsaState, entry: Feedback) => string[];

export type FeedbackFailure = DomainError | EngineStopped;

export interface FeedbackEffectsInput {
  readonly environment: FeedbackEnvironment;
}

export const FeedbackSync = Context.Reference<Duration.Duration>(
  'shinsa/engine/feedback/effects/FeedbackSync',
  {
    defaultValue: () => Duration.minutes(10),
  }
);

export const NO_DRAFT = 'Your agent could not draft this issue. Write the note again to try once more.';

export const STOPPED_WHILE_FILING =
  'Shinsa stopped while it was opening this issue on GitHub. Check the issues on GitHub before you open it again.';
