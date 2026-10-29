import type { Repo, Task, WorkspaceMode } from '@shinsa/core';
import type { BaseUpdate, UpdateOptions } from '../git/update.ts';

interface WorkspaceCheckout {
  path: string;
  branch: string;
  returnBranch?: string;
}

export interface WorkspaceCommit {
  treeHash: string | null;
  files: string[];
  undo: () => Promise<void>;
}

export interface WorkspaceStrategy {
  readonly mode: WorkspaceMode;
  prepare(repo: Repo, task: Task, signal?: AbortSignal): Promise<WorkspaceCheckout>;
  commit(repo: Repo, task: Task, message: string): Promise<WorkspaceCommit>;
  push(repo: Repo, task: Task, signal?: AbortSignal): Promise<string>;
  remove(repo: Repo, task: Task): Promise<void>;
  writeEdit(repo: Repo, task: Task, path: string, write: () => boolean): Promise<void>;
  syncBase(repo: Repo, task: Task, base: string, options: UpdateOptions): Promise<BaseUpdate>;
}

export function requireCheckout(task: Task) {
  if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
  return { path: task.worktreePath, branch: task.branch };
}
