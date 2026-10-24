import type { Repo, Task, WorkspaceMode } from '@shinsa/core';

interface WorkspaceCheckout {
  path: string;
  branch: string;
  returnBranch?: string;
}

export interface WorkspaceCommit {
  treeHash: string | null;
  undo: () => Promise<void>;
  stackedOn?: string;
}

export type CanStackOn = (branch: string) => boolean;

export type ReleaseClaim = () => Promise<void>;

export interface WorkspaceStrategy {
  readonly mode: WorkspaceMode;
  prepare(repo: Repo, task: Task, signal?: AbortSignal): Promise<WorkspaceCheckout>;
  commit(repo: Repo, task: Task, message: string, canStackOn?: CanStackOn): Promise<WorkspaceCommit>;
  push(repo: Repo, task: Task, signal?: AbortSignal): Promise<string>;
  remove(repo: Repo, task: Task): Promise<void>;
  claim(repo: Repo, task: Task, signal?: AbortSignal): Promise<ReleaseClaim>;
}

export const NO_CLAIM: ReleaseClaim = () => Promise.resolve();

export function requireCheckout(task: Task) {
  if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
  return { path: task.worktreePath, branch: task.branch };
}
