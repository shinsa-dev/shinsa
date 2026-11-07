import { type Queue, resolveQueue, type ShinsaState } from '@shinsa/core';
import { useTaskOwnership } from '@/hooks/use-task-ownership.ts';
import { useEveryoneQueue } from '@/lib/preferences/queue.ts';
import { filterOwnQueue } from '@/lib/tasks/owner.ts';

export function useOwnQueue(state: ShinsaState, now = Date.now()): { queue: Queue; shared: boolean } {
  const ownership = useTaskOwnership();
  const everyone = useEveryoneQueue();
  const queue = resolveQueue(state, now);
  return { queue: everyone ? queue : filterOwnQueue(queue, ownership), shared: ownership.shared };
}
