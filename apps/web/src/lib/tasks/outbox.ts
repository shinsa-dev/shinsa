import type { HumanMessage } from '@/lib/chat/timeline.ts';

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
  const listed = messages.length === 0 ? NONE : messages.map(({ at, text }) => ({ at, text }));
  byTask.set(taskId, listed);
  return listed;
}

export async function sendThroughOutbox<T>(taskId: string, text: string, send: () => Promise<T>) {
  const message: OutboxMessage = { taskId, text, at: Date.now() };
  replaceOutbox([...outbox, message]);
  try {
    return await send();
  } finally {
    replaceOutbox(outbox.filter((candidate) => candidate !== message));
  }
}
