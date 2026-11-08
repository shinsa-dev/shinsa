import { type Queue, resolveQueue, type ShinsaState } from '@shinsa/core';
import { useTaskOwnership } from '@/hooks/use-task-ownership.ts';
import { filterOwnQueue } from '@/lib/tasks/owner.ts';

export function useOwnQueue(state: ShinsaState, now = Date.now()): Queue {
  return filterOwnQueue(resolveQueue(state, now), useTaskOwnership());
}
