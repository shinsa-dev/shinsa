import type { ShinsaState, Task } from '@shinsa/core';

export function resolveBranchBase(state: ShinsaState, task: Task) {
  const base = task.baseTaskId ? state.tasks[task.baseTaskId] : undefined;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  return base?.branch ?? task.pullRequest?.base ?? repo?.defaultBranch ?? null;
}
