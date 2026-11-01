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
    options.remote.handleLeaves((userIds) => this.#leave(userIds));
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

  #leave(userIds: string[]) {
    const left = new Set(userIds);
    for (const task of Object.values(this.#engine.state.tasks)) {
      const guest = task.handoff?.guest;
      if (!(guest && left.has(guest.id))) continue;
      const command = { type: 'handoff.leave' as const, taskId: task.id, guestId: guest.id };
      const id = `handoff.leave:${task.id}:${guest.id}:${task.handoff?.claimedAt ?? 0}`;
      this.#engine.dispatch(command, { id }).catch((error: unknown) => {
        log.warn('[Handoff] Could not give a task back', { taskId: task.id, error: describeError(error) });
      });
    }
  }
}
