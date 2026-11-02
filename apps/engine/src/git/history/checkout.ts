import { existsSync } from 'node:fs';
import type { Task } from '@shinsa/core';

export function resolveTaskCheckout(task: Pick<Task, 'workspace' | 'worktreePath'>) {
  if (!task.worktreePath) return null;
  return existsSync(task.worktreePath) ? task.worktreePath : null;
}
