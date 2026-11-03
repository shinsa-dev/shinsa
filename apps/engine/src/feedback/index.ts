import { DomainError } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { FeedbackDraftFailed, type FeedbackDrafter } from './draft/schema.ts';
import {
  FEEDBACK_SYNC,
  type FeedbackEffectsHandle,
  type FeedbackEnvironment,
  FeedbackRecordFailed,
} from './effects/schema.ts';
import { makeFeedbackEffects } from './effects/service.ts';

export { NO_DRAFT, STOPPED_WHILE_FILING } from './effects/schema.ts';
export type { FeedbackEnvironment } from './effects/schema.ts';

export class FeedbackEffects {
  readonly #handle: FeedbackEffectsHandle;

  constructor(
    engine: Engine,
    cwd: string,
    drafter: FeedbackDrafter,
    environment: FeedbackEnvironment,
    syncMs?: number
  ) {
    this.#handle = edgeRuntime.runSync(
      makeFeedbackEffects({
        cwd,
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, id === undefined ? {} : { id }),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new FeedbackRecordFailed({ message: describeError(error) }),
          }),
        draft: (input) =>
          Effect.tryPromise({
            try: () => drafter(input),
            catch: (error) => new FeedbackDraftFailed({ message: describeError(error) }),
          }),
        environment,
        sync: syncMs === undefined ? FEEDBACK_SYNC : Duration.millis(syncMs),
      })
    );
  }

  draft(feedbackId: string, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.draft(feedbackId, context));
  }

  file(feedbackId: string, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.file(feedbackId, context));
  }

  reportExhausted(feedbackId: string, error: string, key: string) {
    return edgeRuntime.runPromise(this.#handle.reportExhausted(feedbackId, error, key));
  }

  recover() {
    return edgeRuntime.runPromise(this.#handle.recover);
  }

  syncIssues(signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#handle.syncIssues(signal));
  }
}
