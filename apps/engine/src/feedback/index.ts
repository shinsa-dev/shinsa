import { listFeedback, listPrivateWords } from '@shinsa/core';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import type { FeedbackDrafter } from './draft.ts';
import { fileFeedbackIssue } from './file.ts';

export const NO_DRAFT = 'Your agent could not draft this issue. Write the note again to try once more.';

export const STOPPED_WHILE_FILING =
  'Shinsa stopped while it was opening this issue on GitHub. Check the issues on GitHub before you open it again.';

export class FeedbackEffects {
  readonly #engine: Engine;
  readonly #cwd: string;
  readonly #drafter: FeedbackDrafter;

  constructor(engine: Engine, cwd: string, drafter: FeedbackDrafter) {
    this.#engine = engine;
    this.#cwd = cwd;
    this.#drafter = drafter;
  }

  async draft(feedbackId: string, context: EffectContext) {
    const entry = this.#engine.state.feedback[feedbackId];
    if (entry?.status !== 'drafting') return;
    const draft = await this.#drafter({
      source: entry.source,
      note: entry.note,
      privateWords: listPrivateWords(this.#engine.state),
    });
    if (context.signal.aborted) return;
    if (!draft) {
      await this.#fail(feedbackId, NO_DRAFT, context.key);
      return;
    }
    await this.#engine.dispatch(
      { type: 'feedback.record_draft', feedbackId, title: draft.title, body: draft.body },
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

  async #fail(feedbackId: string, detail: string, key: string) {
    await this.#engine.dispatch(
      { type: 'feedback.record_failure', feedbackId, detail },
      { id: `${key}:feedback.record_failure` }
    );
  }
}
