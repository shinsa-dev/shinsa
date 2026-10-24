import type { ShinsaState, Task } from '@shinsa/core';

export function resolveBranchBase(state: ShinsaState, task: Task) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  return task.pullRequest?.base ?? repo?.defaultBranch ?? null;
}
