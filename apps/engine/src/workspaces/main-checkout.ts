import { type Repo, resolveRoundBase, type Task } from '@shinsa/core';
import { assertRefName } from '../git/index.ts';
import { runGitOrThrow } from '../git/run.ts';
import { resolveFreeBranch, resolveStartPoint } from '../git/worktree.ts';
import { log } from '../log/index.ts';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import { isGitButlerWorkspace } from './but.ts';
import { NO_CLAIM, refuseUpdate, requireCheckout, type WorkspaceStrategy } from './types.ts';
import { commitCheckout } from './worktrees.ts';

async function resolveCurrentBranch(path: string, signal?: AbortSignal) {
  const result = await runCommand(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], path, { signal });
  return result.ok ? result.stdout : null;
}

export async function isCheckoutClean(path: string, signal?: AbortSignal) {
  const status = await runCommandOrThrow(['git', 'status', '--porcelain'], path, { signal });
  return status.length === 0;
}

export function describeDirtyCheckout(repo: Repo) {
  return `The checkout at ${repo.path} has uncommitted changes. Commit or stash them first: agents work there on a branch of their own and would take them along.`;
}

async function assertOnBranch(path: string, branch: string) {
  const current = await resolveCurrentBranch(path);
  if (current !== branch) {
    throw new Error(
      `The checkout is on ${current ?? 'a detached commit'}, not on the task’s branch ${branch}. Switch it back to ${branch}, then retry.`
    );
  }
}

async function resolveReturnBranch(repo: Repo, task: Task) {
  const branch = task.returnBranch;
  if (!branch || branch === task.branch) return repo.defaultBranch;
  const exists = await runCommand(
    ['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    repo.path
  );
  if (exists.ok) return branch;
  log.info('[Workspaces] The branch the checkout was on is gone, so it goes back to the default branch', {
    taskId: task.id,
    branch,
    defaultBranch: repo.defaultBranch,
  });
  return repo.defaultBranch;
}

export class MainCheckoutStrategy implements WorkspaceStrategy {
  readonly mode = 'main_checkout';

  async prepare(repo: Repo, task: Task, signal?: AbortSignal) {
    if (isGitButlerWorkspace(repo.path)) {
      throw new Error(
        `${repo.name} is a GitButler workspace. Choose GitButler or worktrees for it in Settings → Projects.`
      );
    }
    if (!task.branch) throw new Error('The task has no branch yet.');
    if (task.worktreePath === repo.path && (await resolveCurrentBranch(repo.path, signal)) === task.branch) {
      return { path: repo.path, branch: task.branch };
    }
    if (!(await isCheckoutClean(repo.path, signal))) throw new Error(describeDirtyCheckout(repo));
    if (task.worktreePath === repo.path) {
      await runGitOrThrow(['checkout', '--quiet', assertRefName(task.branch), '--'], repo.path, { signal });
      return { path: repo.path, branch: task.branch };
    }
    const returnBranch = await resolveCurrentBranch(repo.path, signal);
    const base = await resolveStartPoint(repo, resolveRoundBase(task), signal);
    const branch = await resolveFreeBranch(repo, assertRefName(task.branch), signal);
    await runGitOrThrow(['checkout', '--quiet', '--no-track', '-b', branch, base, '--'], repo.path, {
      signal,
    });
    return { path: repo.path, branch, ...(returnBranch ? { returnBranch } : {}) };
  }

  async commit(repo: Repo, task: Task, message: string) {
    await assertOnBranch(repo.path, requireCheckout(task).branch);
    return commitCheckout(repo.path, message);
  }

  async push(repo: Repo, task: Task, signal?: AbortSignal) {
    const branch = assertRefName(requireCheckout(task).branch);
    await runCommandOrThrow(
      ['git', 'push', '--quiet', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`],
      repo.path,
      { timeoutMs: null, signal }
    );
    return runCommandOrThrow(['git', 'rev-parse', `refs/heads/${branch}`], repo.path);
  }

  async remove(repo: Repo, task: Task) {
    const current = await resolveCurrentBranch(repo.path);
    if (current !== task.branch) return;
    if (!(await isCheckoutClean(repo.path))) {
      log.warn('[Workspaces] Left the checkout on the task’s branch: it has uncommitted changes', {
        taskId: task.id,
        path: repo.path,
      });
      return;
    }
    await runGitOrThrow(
      ['checkout', '--quiet', assertRefName(await resolveReturnBranch(repo, task)), '--'],
      repo.path
    );
  }

  claim() {
    return Promise.resolve(NO_CLAIM);
  }

  async writeEdit(repo: Repo, task: Task, _path: string, write: () => boolean) {
    await assertOnBranch(repo.path, requireCheckout(task).branch);
    write();
  }

  listConflicted() {
    return Promise.resolve([]);
  }

  update() {
    return refuseUpdate();
  }
}
