import { Context, Effect, Layer, Option, Schema } from 'effect';
import { QuickCalls } from '../../agents/quick/service.ts';
import { describeFeedbackPrompt } from './prompt.ts';
import {
  FEEDBACK_DRAFT_SCHEMA,
  FEEDBACK_DRAFT_SYSTEM,
  FeedbackDraft,
  type FeedbackDraftInput,
} from './schema.ts';

export class FeedbackDrafter extends Context.Service<
  FeedbackDrafter,
  { draft(input: FeedbackDraftInput): Effect.Effect<FeedbackDraft | null> }
>()('shinsa/engine/feedback/draft/FeedbackDrafter') {
  static readonly layer = Layer.effect(
    FeedbackDrafter,
    Effect.gen(function* () {
      const quick = yield* QuickCalls;
      const decodeDraft = Schema.decodeUnknownOption(FeedbackDraft);

      const draft = Effect.fn('FeedbackDrafter.draft')(function* (input: FeedbackDraftInput) {
        const answer = yield* quick.write<unknown>(
          FEEDBACK_DRAFT_SYSTEM,
          describeFeedbackPrompt(input),
          FEEDBACK_DRAFT_SCHEMA
        );
        return Option.getOrNull(decodeDraft(answer));
      });

      return FeedbackDrafter.of({ draft });
    })
  );
}
