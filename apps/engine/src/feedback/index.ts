import { type Feedback, listFeedback, listPrivateWords, type ShinsaState } from '@shinsa/core';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import type { FeedbackDrafter } from './draft.ts';
import { serializeFeedbackEnvironment } from './environment.ts';
import { fileFeedbackIssue, listFeedbackIssueStates } from './file.ts';

export const NO_DRAFT = 'Your agent could not draft this issue. Write the note again to try once more.';

export const STOPPED_WHILE_FILING =
  'Shinsa stopped while it was opening this issue on GitHub. Check the issues on GitHub before you open it again.';

const FEEDBACK_SYNC_MS = 10 * 60 * 1000;

export type FeedbackEnvironment = (state: ShinsaState, entry: Feedback) => string[];

export class FeedbackEffects {
  readonly #engine: Engine;
  readonly #cwd: string;
  readonly #drafter: FeedbackDrafter;
  readonly #environment: FeedbackEnvironment;
  readonly #syncMs: number;
  #syncedAt = Number.NEGATIVE_INFINITY;

  constructor(
    engine: Engine,
    cwd: string,
    drafter: FeedbackDrafter,
    environment: FeedbackEnvironment,
    syncMs = FEEDBACK_SYNC_MS
  ) {
    this.#engine = engine;
    this.#cwd = cwd;
    this.#drafter = drafter;
    this.#environment = environment;
    this.#syncMs = syncMs;
  }

  async draft(feedbackId: string, context: EffectContext) {
    const entry = this.#engine.state.feedback[feedbackId];
    if (entry?.status !== 'drafting') return;
    const environment = this.#environment(this.#engine.state, entry);
    const draft = await this.#drafter({
      source: entry.source,
      note: entry.note,
      privateWords: listPrivateWords(this.#engine.state),
      context: environment,
    });
    if (context.signal.aborted) return;
    if (!draft) {
      await this.#fail(feedbackId, NO_DRAFT, context.key);
      return;
    }
    await this.#engine.dispatch(
      {
        type: 'feedback.record_draft',
        feedbackId,
        title: draft.title,
        body: `${draft.body}\n\n${serializeFeedbackEnvironment(environment)}`,
      },
      { id: `${context.key}:feedback.record_draft` }
    );
  }

  async file(feedbackId: string, context: EffectContext) {
    const entry = this.#engine.state.feedback[feedbackId];
    if (entry?.status !== 'filing' || !entry.title || !entry.body || context.signal.aborted) return;
    const filing = await fileFeedbackIssue(
      { source: entry.source, title: entry.title, body: entry.body },
      this.#cwd,
      context.signal
    );
    if (context.signal.aborted) return;
    if (!filing.ok) {
      await this.#fail(feedbackId, filing.detail, context.key);
      return;
    }
    await this.#engine.dispatch(
      { type: 'feedback.record_filed', feedbackId, ...filing.issue },
      { id: `${context.key}:feedback.record_filed` }
    );
  }

  async reportExhausted(feedbackId: string, error: string, key: string) {
    await this.#fail(feedbackId, error, key);
  }

  async recover() {
    const stuck = listFeedback(this.#engine.state).filter((entry) => entry.status === 'filing');
    for (const entry of stuck) {
      await this.#fail(entry.id, STOPPED_WHILE_FILING, `feedback.recover:${entry.id}:${entry.updatedAt}`);
    }
  }

  async syncIssues(signal?: AbortSignal) {
    const filed = listFeedback(this.#engine.state).filter((entry) => entry.issue !== null);
    if (filed.length === 0 || signal?.aborted || Date.now() - this.#syncedAt < this.#syncMs) return null;
    this.#syncedAt = Date.now();
    const listing = await listFeedbackIssueStates(this.#cwd, signal);
    if (!listing.ok || signal?.aborted) return listing.ok ? null : listing.detail;
    for (const entry of filed) {
      const number = entry.issue?.number ?? 0;
      if (!listing.states.has(number)) continue;
      await this.#engine.dispatch({
        type: 'feedback.record_issue_state',
        feedbackId: entry.id,
        closedAt: listing.states.get(number) ?? null,
      });
    }
    return null;
  }

  async #fail(feedbackId: string, detail: string, key: string) {
    await this.#engine.dispatch(
      { type: 'feedback.record_failure', feedbackId, detail },
      { id: `${key}:feedback.record_failure` }
    );
  }
}
