import { Deferred, Effect, Ref } from 'effect';
import type { QuestionReply, ReplyWaitersHandle } from './schema.ts';

export const makeReplyWaiters = Effect.fn('ReplyWaiters.make')(function* () {
  const waiters = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<QuestionReply>>>(new Map());

  const remove = (ids: readonly string[]) =>
    Ref.modify(waiters, (current) => {
      const next = new Map(current);
      const taken: Deferred.Deferred<QuestionReply>[] = [];
      for (const id of ids) {
        const waiter = next.get(id);
        if (!waiter) continue;
        next.delete(id);
        taken.push(waiter);
      }
      return [taken, next] as const;
    });

  const open = Effect.fn('ReplyWaiters.open')(function* (id: string) {
    const waiter = yield* Deferred.make<QuestionReply>();
    yield* Ref.update(waiters, (current) => new Map(current).set(id, waiter));
    return waiter;
  });

  const settle = Effect.fn('ReplyWaiters.settle')(function* (id: string, reply: QuestionReply) {
    const [waiter] = yield* remove([id]);
    if (!waiter) return false;
    yield* Deferred.succeed(waiter, reply);
    return true;
  });

  const handle: ReplyWaitersHandle = { open, settle, take: remove };
  return handle;
});
