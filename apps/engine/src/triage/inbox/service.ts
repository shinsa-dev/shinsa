import { DomainError, type InboxMessage, type MessageRoute, needsMessageKind, type Task } from '@shinsa/core';
import { Deferred, Duration, Effect, Ref } from 'effect';
import { resolveMessageRoute } from '../routes.ts';
import { ClassifierFailed, UNDELIVERED_REASON } from '../schema.ts';
import type { InboxDispatchFailed, MessageInboxDefinition, MessageInboxHandle } from './schema.ts';

export const makeMessageInbox = Effect.fn('MessageInbox.make')(function* (
  definition: MessageInboxDefinition
) {
  const working = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<void>>>(new Map());
  const failed = yield* Ref.make<ReadonlySet<string>>(new Set());
  const stopped = yield* Ref.make(false);

  const listWaiting = Effect.fn('MessageInbox.listWaiting')(function* (taskId: string) {
    const state = yield* definition.state;
    const skipped = yield* Ref.get(failed);
    return (state.tasks[taskId]?.inbox ?? []).filter((message) => !skipped.has(message.id));
  });

  const resolveRoute = Effect.fn('MessageInbox.resolveRoute')(function* (task: Task, batch: InboxMessage[]) {
    if (!needsMessageKind(yield* definition.state, task)) return {};
    const text = batch.map((message) => message.text).join('\n\n');
    const timeoutMs = Duration.toMillis(definition.classifyTimeout);
    return yield* definition.classify(task, text).pipe(
      Effect.timeoutOrElse({
        duration: definition.classifyTimeout,
        orElse: () =>
          Effect.fail(
            new ClassifierFailed({ message: `The classifier did not answer within ${timeoutMs} ms.` })
          ),
      }),
      Effect.map(resolveMessageRoute),
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            '[Inbox] Could not classify a message; it goes to the task unclassified, as a follow-up when the task rests'
          ).pipe(
            Effect.annotateLogs({
              taskId: task.id,
              messageIds: batch.map((message) => message.id),
              error: failure.message,
            })
          ),
          {}
        )
      )
    );
  });

  const drop = Effect.fn('MessageInbox.drop')(function* (
    taskId: string,
    messageIds: string[],
    refusal: DomainError | InboxDispatchFailed
  ) {
    const refused = refusal instanceof DomainError;
    if (!refused) {
      yield* Effect.logError('[Inbox] Could not route a message; dropping it').pipe(
        Effect.annotateLogs({ taskId, messageIds, error: refusal.message })
      );
    }
    yield* definition
      .dispatch(
        { type: 'message.drop', taskId, messageIds, reason: refused ? refusal.message : UNDELIVERED_REASON },
        `message.drop:${messageIds.join(',')}`
      )
      .pipe(
        Effect.catch((error) =>
          Effect.andThen(
            Ref.update(failed, (current) => new Set([...current, ...messageIds])),
            Effect.logError(
              '[Inbox] Could not route a message; it stays in the inbox until the next start'
            ).pipe(Effect.annotateLogs({ taskId, messageIds, error: error.message }))
          )
        )
      );
  });

  const deliver = Effect.fn('MessageInbox.deliver')(function* (
    taskId: string,
    batch: InboxMessage[],
    route: MessageRoute
  ) {
    const messageIds = batch.map((message) => message.id);
    if (yield* Ref.get(stopped)) {
      yield* Effect.logInfo('[Inbox] Left messages in the inbox for the next start').pipe(
        Effect.annotateLogs({ taskId, messageIds })
      );
      return;
    }
    yield* definition
      .dispatch(
        { type: 'message.route', taskId, messageIds, ...route },
        `message.route:${messageIds.join(',')}`
      )
      .pipe(Effect.catch((refusal) => drop(taskId, messageIds, refusal)));
  });

  const drain = Effect.fn('MessageInbox.drain')(function* (taskId: string) {
    for (;;) {
      const task = (yield* definition.state).tasks[taskId];
      const batch = yield* listWaiting(taskId);
      if ((yield* Ref.get(stopped)) || !task || batch.length === 0) return;
      yield* deliver(taskId, batch, yield* resolveRoute(task, batch));
    }
  });

  const finish = (taskId: string, done: Deferred.Deferred<void>) =>
    Ref.update(working, (current) => {
      const next = new Map(current);
      next.delete(taskId);
      return next;
    }).pipe(Effect.andThen(Deferred.succeed(done, undefined)));

  const sync = Effect.gen(function* () {
    if (yield* Ref.get(stopped)) return;
    for (const task of Object.values((yield* definition.state).tasks)) {
      if ((yield* Ref.get(working)).has(task.id) || (yield* listWaiting(task.id)).length === 0) continue;
      const done = yield* Deferred.make<void>();
      yield* Ref.update(working, (current) => new Map(current).set(task.id, done));
      yield* Effect.forkDetach(drain(task.id).pipe(Effect.ensuring(finish(task.id, done))));
    }
  });

  const settle = Effect.gen(function* () {
    for (;;) {
      const waits = [...(yield* Ref.get(working)).values()];
      if (waits.length === 0) return;
      yield* Effect.forEach(waits, Deferred.await, { discard: true });
    }
  });

  const handle: MessageInboxHandle = { sync, settle, stop: Ref.set(stopped, true) };
  return handle;
});
