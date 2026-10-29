import { type ShinsaState, selectTaskByReference } from '@shinsa/core';

export function findForkSource(state: ShinsaState, reference: string) {
  const task = selectTaskByReference(state, reference);
  if (task) return task.id;
  throw new Error(`There is no task "${reference}" to fork. Find it with find_tasks and pass its id.`);
}
