import { DomainError } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { InboxDispatchFailed, type InboxOptions, type MessageInboxHandle } from './inbox/schema.ts';
import { makeMessageInbox } from './inbox/service.ts';
import { CLASSIFY_TIMEOUT_MS, ClassifierFailed, type MessageClassifier } from './schema.ts';

export class MessageInbox {
  readonly #engine: Engine;
  readonly #handle: MessageInboxHandle;
  #unsubscribe: (() => void) | null = null;

  constructor(engine: Engine, classify: MessageClassifier, options: InboxOptions = {}) {
    this.#engine = engine;
    this.#handle = edgeRuntime.runSync(
      makeMessageInbox({
        state: Effect.sync(() => engine.state),
        classify: (task, text) =>
          Effect.tryPromise({
            try: () => classify(task, text),
            catch: (error) => new ClassifierFailed({ message: describeError(error) }),
          }),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new InboxDispatchFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
        classifyTimeout: Duration.millis(options.classifyTimeoutMs ?? CLASSIFY_TIMEOUT_MS),
      })
    );
  }

  start() {
    this.#unsubscribe = this.#engine.subscribe(() => this.sync());
    this.sync();
  }

  sync() {
    edgeRuntime.runSync(this.#handle.sync);
  }

  settle() {
    return edgeRuntime.runPromise(this.#handle.settle);
  }

  stop() {
    edgeRuntime.runSync(this.#handle.stop);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
