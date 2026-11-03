import { Effect, Option, Schema } from 'effect';
import { describeFeedbackPrompt } from './prompt.ts';
import {
  FEEDBACK_DRAFT_SCHEMA,
  FEEDBACK_DRAFT_SYSTEM,
  FeedbackDraft,
  type FeedbackDraftDefinition,
  type FeedbackDraftInput,
} from './schema.ts';

export const makeFeedbackDrafter = (definition: FeedbackDraftDefinition) =>
  Effect.sync(() => {
    const decodeDraft = Schema.decodeUnknownOption(FeedbackDraft);

    return Effect.fn('FeedbackDrafter.draft')(function* (input: FeedbackDraftInput) {
      const answer = yield* definition.ask(
        FEEDBACK_DRAFT_SYSTEM,
        describeFeedbackPrompt(input),
        FEEDBACK_DRAFT_SCHEMA
      );
      return Option.getOrNull(decodeDraft(answer));
    });
  });
