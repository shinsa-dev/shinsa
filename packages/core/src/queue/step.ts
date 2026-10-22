import type { Queue, QueueStep } from './types.ts';

export function listDecisionOrder(queue: Queue) {
  return [...new Set(queue.ready.map((entry) => entry.task.id))];
}

export function resolveQueueStep(
  order: string[],
  taskId: string,
  previousOrder: string[] = order
): QueueStep {
  const index = order.indexOf(taskId);
  if (index >= 0) {
    return {
      position: index + 1,
      total: order.length,
      previousId: order[index - 1] ?? null,
      nextId: order[index + 1] ?? null,
    };
  }
  const present = new Set(order);
  const was = previousOrder.indexOf(taskId);
  const after = was < 0 ? undefined : previousOrder.slice(was + 1).find((id) => present.has(id));
  const before =
    was < 0
      ? undefined
      : previousOrder
          .slice(0, was)
          .reverse()
          .find((id) => present.has(id));
  return {
    position: null,
    total: order.length,
    previousId: before ?? null,
    nextId: after ?? order[0] ?? null,
  };
}
