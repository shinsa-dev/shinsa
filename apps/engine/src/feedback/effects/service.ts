import { listFeedback, listPrivateWords } from '@shinsa/core';
import { Clock, Duration, Effect, Ref } from 'effect';
import type { EffectContext } from '../../runtime/engine/schema.ts';
import { serializeFeedbackEnvironment } from '../environment.ts';
import { FeedbackIssues } from '../issues/service.ts';
import {
  type FeedbackEffectsDefinition,
  type FeedbackEffectsHandle,
  NO_DRAFT,
  STOPPED_WHILE_FILING,
} from './schema.ts';

export const makeFeedbackEffects = Effect.fn('FeedbackEffects.make')(function* (
  definition: FeedbackEffectsDefinition
) {
  const issues = yield* FeedbackIssues;
  const syncedAt = yield* Ref.make(Number.NEGATIVE_INFINITY);

  const fail = (feedbackId: string, detail: string, key: string) =>
    Effect.asVoid(
      definition.dispatch(
        { type: 'feedback.record_failure', feedbackId, detail },
        `${key}:feedback.record_failure`
      )
    );

  const draft = Effect.fn('FeedbackEffects.draft')(function* (feedbackId: string, context: EffectContext) {
    const state = yield* definition.state;
    const entry = state.feedback[feedbackId];
    if (entry?.status !== 'drafting') return;
    const environment = definition.environment(state, entry);
    const drafted = yield* definition.draft({
      source: entry.source,
      note: entry.note,
      privateWords: listPrivateWords(state),
      context: environment,
    });
    if (context.signal.aborted) return;
    if (!drafted) return yield* fail(feedbackId, NO_DRAFT, context.key);
    yield* definition.dispatch(
      {
        type: 'feedback.record_draft',
        feedbackId,
        title: drafted.title,
        body: `${drafted.body}\n\n${serializeFeedbackEnvironment(environment)}`,
      },
      `${context.key}:feedback.record_draft`
    );
  });

  const file = Effect.fn('FeedbackEffects.file')(function* (feedbackId: string, context: EffectContext) {
    const entry = (yield* definition.state).feedback[feedbackId];
    if (entry?.status !== 'filing' || !entry.title || !entry.body || context.signal.aborted) return;
    const filing = yield* issues
      .file({ source: entry.source, title: entry.title, body: entry.body }, definition.cwd, context.signal)
      .pipe(Effect.result);
    if (context.signal.aborted) return;
    if (filing._tag === 'Failure') return yield* fail(feedbackId, filing.failure.message, context.key);
    yield* definition.dispatch(
      { type: 'feedback.record_filed', feedbackId, ...filing.success },
      `${context.key}:feedback.record_filed`
    );
  });

  const recover = Effect.gen(function* () {
    const stuck = listFeedback(yield* definition.state).filter((entry) => entry.status === 'filing');
    for (const entry of stuck)
      yield* fail(entry.id, STOPPED_WHILE_FILING, `feedback.recover:${entry.id}:${entry.updatedAt}`);
  });

  const syncIssues = Effect.fn('FeedbackEffects.syncIssues')(function* (signal?: AbortSignal) {
    const filed = listFeedback(yield* definition.state).filter((entry) => entry.issue !== null);
    const now = yield* Clock.currentTimeMillis;
    if (
      filed.length === 0 ||
      signal?.aborted ||
      now - (yield* Ref.get(syncedAt)) < Duration.toMillis(definition.sync)
    )
      return null;
    yield* Ref.set(syncedAt, now);
    const listing = yield* issues.listStates(definition.cwd, signal).pipe(Effect.result);
    if (listing._tag === 'Failure') return listing.failure.message;
    if (signal?.aborted) return null;
    for (const entry of filed) {
      const number = entry.issue?.number ?? 0;
      if (!listing.success.has(number)) continue;
      yield* definition.dispatch({
        type: 'feedback.record_issue_state',
        feedbackId: entry.id,
        closedAt: listing.success.get(number) ?? null,
      });
    }
    return null;
  });

  const handle: FeedbackEffectsHandle = {
    draft,
    file,
    reportExhausted: fail,
    recover,
    syncIssues,
  };
  return handle;
});
