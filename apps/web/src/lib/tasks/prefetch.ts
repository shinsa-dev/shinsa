import { resolveQueue, type ShinsaState } from '@shinsa/core';

export const IDLE_PREFETCH_TASKS = 4;

const ROW = 'a, button, [role=button], [role=option], [role=treeitem], [data-task]';

export function findTaskTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest(ROW);
  if (!row) return null;
  return (
    (row.getAttribute('data-task') ?? row.querySelector('[data-task]')?.getAttribute('data-task')) || null
  );
}

export function listIdleTasks(state: ShinsaState, now: number) {
  const queue = resolveQueue(state, now);
  const ids = [...queue.upNow.map((entry) => entry.task.id), ...queue.working.map((task) => task.id)];
  return [...new Set(ids)].slice(0, IDLE_PREFETCH_TASKS);
}

const SELECTED_TASK = /^(?:task|recent|jump):(.+)$/;

export function resolveSelectedTask(selected: string) {
  return SELECTED_TASK.exec(selected)?.[1] ?? null;
}
