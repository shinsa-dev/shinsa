import { resolve } from 'node:path';
import type { Repo, Task } from '@shinsa/core';
import { Effect } from 'effect';
import { NO_WORKTREE, TaskCheckoutMissing } from './schema.ts';

export const requireCheckout = Effect.fn('Workspaces.requireCheckout')(function* (task: Task) {
  if (!task.worktreePath || !task.branch) return yield* new TaskCheckoutMissing({ message: NO_WORKTREE });
  return { path: task.worktreePath, branch: task.branch };
});

export function isRepositoryPath(repo: Pick<Repo, 'path'>, path: string) {
  return resolve(path) === resolve(repo.path);
}
