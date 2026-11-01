import { existsSync } from 'node:fs';
import { isLaterRound, type Repo, resolveRoundBase, type Task } from '@shinsa/core';
import {
  commitWorktree,
  createWorktree,
  discardEdits,
  listChangedFiles,
  pushBranch,
  refreshWorktree,
  removeWorktree,
  resolveHead,
  resolveTree,
  updateOntoBase,
  writeMergeHead,
} from '../git/index.ts';
import { runGitOrThrow } from '../git/run.ts';
import type { UpdateOptions } from '../git/update.ts';
import { requireCheckout, type WorkspaceCommit, type WorkspaceStrategy } from './types.ts';

export async function commitCheckout(path: string, message: string): Promise<WorkspaceCommit> {
  const before = await resolveHead(path);
  const committed = await commitWorktree(path, message);
  return {
    treeHash: await resolveTree(path),
    files: await listChangedFiles(path, before, 'HEAD'),
    undo: async () => {
      if (!committed) return;
      await runGitOrThrow(['reset', '--soft', before], path);
      if (committed.merge) await writeMergeHead(path, committed.merge);
    },
  };
}

export class WorktreeStrategy implements WorkspaceStrategy {
  readonly mode = 'worktrees';
  readonly #worktreesDir: string;

  constructor(worktreesDir: string) {
    this.#worktreesDir = worktreesDir;
  }

  async prepare(repo: Repo, task: Task, signal?: AbortSignal) {
    const { worktreePath, branch } = task;
    if (worktreePath && branch && existsSync(worktreePath)) {
      if (task.phaseReports.length === 0 && isLaterRound(task)) await discardEdits(worktreePath, signal);
      else if (task.phaseReports.length === 0 && !task.pullRequest)
        await refreshWorktree(repo, worktreePath, resolveRoundBase(task), signal);
      return { path: worktreePath, branch };
    }
    if (!branch) throw new Error('The task has no branch yet.');
    return createWorktree(repo, this.#worktreesDir, task.id, branch, resolveRoundBase(task), signal);
  }

  commit(_repo: Repo, task: Task, message: string) {
    return commitCheckout(requireCheckout(task).path, message);
  }

  async push(_repo: Repo, task: Task, signal?: AbortSignal) {
    const { path, branch } = requireCheckout(task);
    await pushBranch(path, branch, signal);
    return resolveHead(path);
  }

  async remove(repo: Repo, task: Task) {
    if (task.worktreePath) await removeWorktree(repo, task.worktreePath);
  }

  writeEdit(_repo: Repo, _task: Task, _path: string, write: () => boolean) {
    write();
    return Promise.resolve();
  }

  syncBase(_repo: Repo, task: Task, base: string, options: UpdateOptions) {
    const { path, branch } = requireCheckout(task);
    return updateOntoBase(path, base, branch, options);
  }
}
