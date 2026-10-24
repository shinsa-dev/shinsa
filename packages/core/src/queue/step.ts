import type { Queue, QueueStep } from './types.ts';

export function listDecisionOrder(queue: Queue) {
  return [...new Set(queue.ready.map((entry) => entry.task.id))];
}

export function resolveQueueStep(order: string[], taskId: string): QueueStep {
  const index = order.indexOf(taskId);
  if (index < 0) return { position: null, total: order.length, previousId: null, nextId: order[0] ?? null };
  return {
    position: index + 1,
    total: order.length,
    previousId: order[index - 1] ?? null,
    nextId: order[index + 1] ?? null,
  };
}
