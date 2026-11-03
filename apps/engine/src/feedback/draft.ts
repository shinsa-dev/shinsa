import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type FeedbackDrafter, FeedbackDraftFailed } from './draft/schema.ts';
import { makeFeedbackDrafter } from './draft/service.ts';

export { describeFeedbackPrompt } from './draft/prompt.ts';
export type { FeedbackDrafter } from './draft/schema.ts';

export function createFeedbackDrafter(ask: QuickJson): FeedbackDrafter {
  const draft = edgeRuntime.runSync(
    makeFeedbackDrafter({
      ask: (system, prompt, schema) =>
        Effect.tryPromise({
          try: () => ask<unknown>(system, prompt, schema),
          catch: (error) => new FeedbackDraftFailed({ message: describeError(error) }),
        }),
    })
  );
  return (input) => edgeRuntime.runPromise(draft(input));
}
