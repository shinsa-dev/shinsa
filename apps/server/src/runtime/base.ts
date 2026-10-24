import { resolveRoundBase, type ShinsaState, type Task } from '@shinsa/core';

export function resolveTaskBaseBranch(state: ShinsaState, task: Task) {
  const round = resolveRoundBase(task);
  if (round) return round;
  const base = task.baseTaskId ? state.tasks[task.baseTaskId] : undefined;
  if (base?.branch && base.stage !== 'merged' && base.stage !== 'cancelled') return base.branch;
  return null;
}
