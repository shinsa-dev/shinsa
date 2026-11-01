import { DomainError, type RemoteUser } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { EffectError } from '../runtime/failures.ts';
import type { Remote } from './index.ts';

const FINAL = { retryable: false, delayMs: null };

const CLAIM_FAILED = 'This machine could not hand the task to you. Try the link again in a moment.';

export interface HandoffEffects {
  link: (taskId: string, context: EffectContext) => Promise<void>;
  revoke: (taskId: string, guestId: string | null) => Promise<void>;
}

export interface HandoffsOptions {
  engine: Engine;
  remote: Remote;
}

export class Handoffs implements HandoffEffects {
  readonly #engine: Engine;
  readonly #remote: Remote;

  constructor(options: HandoffsOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    options.remote.handleClaims((taskId, user) => this.#claim(taskId, user));
  }

  async link(taskId: string, context: EffectContext) {
    const handoff = this.#engine.state.tasks[taskId]?.handoff;
    if (!handoff || handoff.guest) return;
    let url: string;
    try {
      url = await this.#remote.createHandoff(taskId);
    } catch (error) {
      if (error instanceof DomainError) throw new EffectError(error.message, error.message, FINAL);
      throw error;
    }
    await this.#engine.dispatch(
      { type: 'handoff.record', taskId, url },
      { id: `${context.key}:handoff.record` }
    );
  }

  revoke(taskId: string, guestId: string | null) {
    return this.#remote.removeHandoff(taskId, guestId);
  }

  async #claim(taskId: string, user: RemoteUser) {
    const guest = { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl };
    try {
      await this.#engine.dispatch({ type: 'handoff.claim', taskId, guest });
      return null;
    } catch (error) {
      if (error instanceof DomainError) return error.message;
      log.warn('[Handoff] Could not record a claim', { taskId, error: describeError(error) });
      return CLAIM_FAILED;
    }
  }
}
