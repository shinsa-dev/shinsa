import { DomainError, type InboxMessage, type MessageRoute, type Task } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { type MessageClassifier, resolveMessageRoute } from './message.ts';

export class MessageInbox {
  readonly #engine: Engine;
  readonly #classify: MessageClassifier;
  readonly #working = new Map<string, Promise<void>>();
  readonly #failed = new Set<string>();
  readonly #tails = new Map<string, Promise<void>>();
  #unsubscribe: (() => void) | null = null;
  #stopped = false;

  constructor(engine: Engine, classify: MessageClassifier) {
    this.#engine = engine;
    this.#classify = classify;
  }

  start() {
    this.#unsubscribe = this.#engine.subscribe(() => this.sync());
    this.sync();
  }

  sync() {
    if (this.#stopped) return;
    for (const task of Object.values(this.#engine.state.tasks)) {
      for (const message of task.inbox ?? []) {
        if (this.#working.has(message.id) || this.#failed.has(message.id)) continue;
        this.#working.set(message.id, this.#take(task, message));
      }
    }
  }

  async settle() {
    while (this.#working.size > 0) await Promise.all(this.#working.values());
  }

  stop() {
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #take(task: Task, message: InboxMessage) {
    const taskId = task.id;
    const route = this.#resolveRoute(task, message);
    const routed = (this.#tails.get(taskId) ?? Promise.resolve()).then(async () =>
      this.#deliver(taskId, message, await route)
    );
    this.#tails.set(taskId, routed);
    try {
      await routed;
    } finally {
      this.#working.delete(message.id);
      if (this.#tails.get(taskId) === routed) this.#tails.delete(taskId);
    }
  }

  async #resolveRoute(task: Task, message: InboxMessage): Promise<MessageRoute> {
    try {
      return resolveMessageRoute(await this.#classify(task, message.text));
    } catch (error) {
      log.warn(
        '[Inbox] Could not classify a message; it goes to the task unclassified, as a follow-up when the task rests',
        {
          taskId: task.id,
          messageId: message.id,
          error: describeError(error),
        }
      );
      return {};
    }
  }

  async #deliver(taskId: string, message: InboxMessage, route: MessageRoute) {
    if (this.#stopped) {
      log.info('[Inbox] Left a message in the inbox for the next start', { taskId, messageId: message.id });
      return;
    }
    try {
      await this.#engine.dispatch(
        { type: 'message.route', taskId, messageId: message.id, ...route },
        { id: `message.route:${message.id}` }
      );
    } catch (error) {
      await this.#drop(taskId, message, error);
    }
  }

  async #drop(taskId: string, message: InboxMessage, refusal: unknown) {
    try {
      if (!(refusal instanceof DomainError)) throw refusal;
      await this.#engine.dispatch(
        { type: 'message.drop', taskId, messageId: message.id, reason: refusal.message },
        { id: `message.drop:${message.id}` }
      );
    } catch (error) {
      this.#failed.add(message.id);
      log.error('[Inbox] Could not route a message; it stays in the inbox until the next start', {
        taskId,
        messageId: message.id,
        error: describeError(error),
      });
    }
  }
}
