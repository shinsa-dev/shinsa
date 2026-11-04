import { listFeedback, listPrivateWords, type ShinsaCommand } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Ref } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { FeedbackDrafter } from '../draft/service.ts';
import { serializeFeedbackEnvironment } from '../environment.ts';
import { FeedbackIssues } from '../issues/service.ts';
import {
  type FeedbackEffectsInput,
  type FeedbackFailure,
  FeedbackSync,
  NO_DRAFT,
  STOPPED_WHILE_FILING,
} from './schema.ts';

export class FeedbackEffects extends Context.Service<
  FeedbackEffects,
  {
    draft(feedbackId: string, key: string): Effect.Effect<void, FeedbackFailure>;
    file(feedbackId: string, key: string): Effect.Effect<void, FeedbackFailure>;
    reportExhausted(feedbackId: string, error: string, key: string): Effect.Effect<void, FeedbackFailure>;
    readonly recover: Effect.Effect<void, FeedbackFailure>;
    readonly syncIssues: Effect.Effect<string | null, FeedbackFailure>;
  }
>()('shinsa/engine/feedback/effects/FeedbackEffects') {
  static readonly layer = (input: FeedbackEffectsInput) =>
    Layer.effect(
      FeedbackEffects,
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const config = yield* EngineConfig;
        const issues = yield* FeedbackIssues;
        const drafter = yield* FeedbackDrafter;
        const sync = yield* FeedbackSync;
        const syncedAt = yield* Ref.make(Number.NEGATIVE_INFINITY);

        const dispatch = (command: ShinsaCommand, id?: string) =>
          Effect.asVoid(engine.dispatch(command, id === undefined ? {} : { id }));

        const fail = (feedbackId: string, detail: string, key: string) =>
          dispatch({ type: 'feedback.record_failure', feedbackId, detail }, `${key}:feedback.record_failure`);

        const draft = Effect.fn('FeedbackEffects.draft')(function* (feedbackId: string, key: string) {
          const state = yield* engine.state;
          const entry = state.feedback[feedbackId];
          if (entry?.status !== 'drafting') return;
          const environment = input.environment(state, entry);
          const drafted = yield* drafter.draft({
            source: entry.source,
            note: entry.note,
            privateWords: listPrivateWords(state),
            context: environment,
          });
          if (!drafted) return yield* fail(feedbackId, NO_DRAFT, key);
          yield* dispatch(
            {
              type: 'feedback.record_draft',
              feedbackId,
              title: drafted.title,
              body: `${drafted.body}\n\n${serializeFeedbackEnvironment(environment)}`,
            },
            `${key}:feedback.record_draft`
          );
        });

        const file = Effect.fn('FeedbackEffects.file')(function* (feedbackId: string, key: string) {
          const entry = (yield* engine.state).feedback[feedbackId];
          if (entry?.status !== 'filing' || !entry.title || !entry.body) return;
          const filing = yield* issues
            .file({ source: entry.source, title: entry.title, body: entry.body }, config.dataDir)
            .pipe(Effect.result);
          if (filing._tag === 'Failure') return yield* fail(feedbackId, filing.failure.message, key);
          yield* dispatch(
            { type: 'feedback.record_filed', feedbackId, ...filing.success },
            `${key}:feedback.record_filed`
          );
        });

        const recover = Effect.gen(function* () {
          const stuck = listFeedback(yield* engine.state).filter((entry) => entry.status === 'filing');
          for (const entry of stuck)
            yield* fail(entry.id, STOPPED_WHILE_FILING, `feedback.recover:${entry.id}:${entry.updatedAt}`);
        });

        const syncIssues = Effect.gen(function* () {
          const filed = listFeedback(yield* engine.state).filter((entry) => entry.issue !== null);
          const now = yield* Clock.currentTimeMillis;
          if (filed.length === 0 || now - (yield* Ref.get(syncedAt)) < Duration.toMillis(sync)) return null;
          yield* Ref.set(syncedAt, now);
          const listing = yield* issues.listStates(config.dataDir).pipe(Effect.result);
          if (listing._tag === 'Failure') return listing.failure.message;
          for (const entry of filed) {
            const number = entry.issue?.number ?? 0;
            if (!listing.success.has(number)) continue;
            yield* dispatch({
              type: 'feedback.record_issue_state',
              feedbackId: entry.id,
              closedAt: listing.success.get(number) ?? null,
            });
          }
          return null;
        });

        return FeedbackEffects.of({ draft, file, reportExhausted: fail, recover, syncIssues });
      })
    );
}
