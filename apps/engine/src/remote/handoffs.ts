import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EffectContext } from '../runtime/engine.ts';
import {
  HandoffCallFailed,
  HandoffCommandFailed,
  type HandoffEffects,
  type HandoffsHandle,
  type HandoffsOptions,
} from './handoffs/schema.ts';
import { makeHandoffs } from './handoffs/service.ts';

export type { HandoffEffects, HandoffsOptions } from './handoffs/schema.ts';

export class Handoffs implements HandoffEffects {
  readonly #handle: HandoffsHandle;

  constructor(options: HandoffsOptions) {
    const { engine, remote } = options;
    this.#handle = edgeRuntime.runSync(
      makeHandoffs({
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, id === undefined ? {} : { id }),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new HandoffCommandFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
        createHandoff: (taskId) =>
          Effect.tryPromise({
            try: () => remote.createHandoff(taskId),
            catch: (error) =>
              error instanceof DomainError ? error : new HandoffCallFailed({ message: describeError(error) }),
          }),
        removeHandoff: (taskId, guestId) =>
          Effect.tryPromise({
            try: () => remote.removeHandoff(taskId, guestId),
            catch: (error) => new HandoffCallFailed({ message: describeError(error) }),
          }),
      })
    );
    remote.handleClaims((taskId, guest) => edgeRuntime.runPromise(this.#handle.claim(taskId, guest)));
    remote.handleLeaves((userIds) => edgeRuntime.runSync(this.#handle.leave(userIds)));
  }

  link(taskId: string, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.link(taskId, context));
  }

  revoke(taskId: string, guestId: string | null) {
    return edgeRuntime.runPromise(this.#handle.revoke(taskId, guestId));
  }
}
