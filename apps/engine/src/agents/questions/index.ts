import { Deferred, Effect } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import { type QuestionReply, type ReplyWaitersHandle, WITHDRAWN } from './schema.ts';
import { makeReplyWaiters } from './service.ts';

export class ReplyWaiters {
  readonly #handle: ReplyWaitersHandle = edgeRuntime.runSync(makeReplyWaiters());

  open(id: string, signal: AbortSignal) {
    const waiter = edgeRuntime.runSync(this.#handle.open(id));
    const withdraw = () => {
      this.settle(id, WITHDRAWN);
    };
    signal.addEventListener('abort', withdraw, { once: true });
    return edgeRuntime.runPromise(
      Deferred.await(waiter).pipe(
        Effect.ensuring(Effect.sync(() => signal.removeEventListener('abort', withdraw)))
      )
    );
  }

  settle(id: string, reply: QuestionReply) {
    return edgeRuntime.runSync(this.#handle.settle(id, reply));
  }

  take(ids: readonly string[]) {
    const waiters = edgeRuntime.runSync(this.#handle.take(ids));
    return () => {
      edgeRuntime.runSync(
        Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, WITHDRAWN), { discard: true })
      );
    };
  }
}
