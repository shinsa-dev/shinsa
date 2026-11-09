import type { ShinsaState, Task } from '@shinsa/core';

export function selectLedInitiative(state: ShinsaState, task: Task) {
  if (!task.initiativeId) return null;
  const initiative = state.initiatives[task.initiativeId];
  return initiative?.leadTaskId === task.id ? initiative : null;
}
