import type { ReviewComment } from '@shinsa/core';
import { Clock, Effect } from 'effect';
import type { HumanMessage } from '@/lib/chat/timeline.ts';
import { runApp } from '@/lib/runtime/app.ts';

interface OutboxMessage extends HumanMessage {
  taskId: string;
}

const NONE: HumanMessage[] = [];

let outbox: OutboxMessage[] = [];
const byTask = new Map<string, HumanMessage[]>();
const listeners = new Set<() => void>();

function replaceOutbox(next: OutboxMessage[]) {
  outbox = next;
  byTask.clear();
  for (const listener of listeners) listener();
}

export function subscribeToOutbox(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listOutboxMessages(taskId: string) {
  const cached = byTask.get(taskId);
  if (cached) return cached;
  const messages = outbox.filter((message) => message.taskId === taskId);
  const listed =
    messages.length === 0
      ? NONE
      : messages.map(({ at, text, comments }) => ({ at, text, ...(comments ? { comments } : {}) }));
  byTask.set(taskId, listed);
  return listed;
}

export function sendThroughOutbox<T>(
  taskId: string,
  text: string,
  send: () => Promise<T>,
  comments: ReviewComment[] = []
) {
  return runApp(
    Effect.acquireUseRelease(
      Clock.currentTimeMillis.pipe(
        Effect.map((at): OutboxMessage => ({
          taskId,
          text,
          at,
          ...(comments.length > 0 ? { comments } : {}),
        })),
        Effect.tap((message) => Effect.sync(() => replaceOutbox([...outbox, message])))
      ),
      () => Effect.promise(send),
      (message) => Effect.sync(() => replaceOutbox(outbox.filter((candidate) => candidate !== message)))
    )
  );
}
