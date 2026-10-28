import { DomainError, type InboxMessage, type MessageRoute, needsMessageKind, type Task } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { type MessageClassifier, resolveMessageRoute } from './message.ts';

const CLASSIFY_TIMEOUT_MS = 30_000;

const UNDELIVERED_REASON = 'Shinsa could not deliver it. Send it again.';

interface InboxOptions {
  classifyTimeoutMs?: number;
}

export class MessageInbox {
  readonly #engine: Engine;
  readonly #classify: MessageClassifier;
  readonly #classifyTimeoutMs: number;
  readonly #working = new Map<string, Promise<void>>();
  readonly #failed = new Set<string>();
  #unsubscribe: (() => void) | null = null;
  #stopped = false;

  constructor(engine: Engine, classify: MessageClassifier, options: InboxOptions = {}) {
    this.#engine = engine;
    this.#classify = classify;
    this.#classifyTimeoutMs = options.classifyTimeoutMs ?? CLASSIFY_TIMEOUT_MS;
  }

  start() {
    this.#unsubscribe = this.#engine.subscribe(() => this.sync());
    this.sync();
  }

  sync() {
    if (this.#stopped) return;
    for (const task of Object.values(this.#engine.state.tasks)) {
      if (this.#working.has(task.id) || this.#listWaiting(task.id).length === 0) continue;
      this.#working.set(task.id, this.#drain(task.id));
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

  #listWaiting(taskId: string) {
    return (this.#engine.state.tasks[taskId]?.inbox ?? []).filter((message) => !this.#failed.has(message.id));
  }

  async #drain(taskId: string) {
    try {
      for (;;) {
        const task = this.#engine.state.tasks[taskId];
        const batch = this.#listWaiting(taskId);
        if (this.#stopped || !task || batch.length === 0) return;
        await this.#deliver(taskId, batch, await this.#resolveRoute(task, batch));
      }
    } finally {
      this.#working.delete(taskId);
    }
  }

  async #resolveRoute(task: Task, batch: InboxMessage[]): Promise<MessageRoute> {
    if (!needsMessageKind(this.#engine.state, task)) return {};
    const text = batch.map((message) => message.text).join('\n\n');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The classifier did not answer within ${this.#classifyTimeoutMs} ms.`)),
        this.#classifyTimeoutMs
      );
    });
    try {
      return resolveMessageRoute(await Promise.race([this.#classify(task, text), timeout]));
    } catch (error) {
      log.warn(
        '[Inbox] Could not classify a message; it goes to the task unclassified, as a follow-up when the task rests',
        { taskId: task.id, messageIds: batch.map((message) => message.id), error: describeError(error) }
      );
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  async #deliver(taskId: string, batch: InboxMessage[], route: MessageRoute) {
    const messageIds = batch.map((message) => message.id);
    if (this.#stopped) {
      log.info('[Inbox] Left messages in the inbox for the next start', { taskId, messageIds });
      return;
    }
    try {
      await this.#engine.dispatch(
        { type: 'message.route', taskId, messageIds, ...route },
        { id: `message.route:${messageIds.join(',')}` }
      );
    } catch (error) {
      await this.#drop(taskId, messageIds, error);
    }
  }

  async #drop(taskId: string, messageIds: string[], refusal: unknown) {
    const reason = refusal instanceof DomainError ? refusal.message : UNDELIVERED_REASON;
    if (!(refusal instanceof DomainError)) {
      log.error('[Inbox] Could not route a message; dropping it', {
        taskId,
        messageIds,
        error: describeError(refusal),
      });
    }
    try {
      await this.#engine.dispatch(
        { type: 'message.drop', taskId, messageIds, reason },
        { id: `message.drop:${messageIds.join(',')}` }
      );
    } catch (error) {
      for (const messageId of messageIds) this.#failed.add(messageId);
      log.error('[Inbox] Could not route a message; it stays in the inbox until the next start', {
        taskId,
        messageIds,
        error: describeError(error),
      });
    }
  }
}
