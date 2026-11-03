import { mkdirSync } from 'node:fs';
import {
  type DelegatedRun,
  isDelegatedRun,
  type Repo,
  type Run,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Effect } from 'effect';
import { resolveScratchPath } from '../../config/index.ts';
import { createIsolatedWorktree, resolveIsolatedPath } from '../../git/index.ts';
import { describeError } from '../../log/index.ts';
import { assertWorktreeRoot } from '../../workspaces/index.ts';
import { IsolationFailed, SCRATCH_BRANCH, type Workspace, WorkspaceUnavailable } from './schema.ts';
import { RunWorld } from './world/service.ts';

type WorkspaceWorld = Pick<RunWorld['Service'], 'config' | 'worktreeRoot'>;

function resolveRoleCwd(run: Run, task: Task, repo: Repo) {
  const role = run.role;
  if (role === 'answerer' || run.purpose === 'watch' || run.purpose === 'intake') return repo.path;
  if (role === 'researcher') return task.worktreePath ?? repo.path;
  return task.worktreePath;
}

function resolveCwd(world: WorkspaceWorld, run: Run, task: Task, repo: Repo) {
  if (!isDelegatedRun(run)) return resolveRoleCwd(run, task, repo);
  if (run.delegation.isolation === 'worktree')
    return resolveIsolatedPath(world.worktreeRoot.path, task.id, run.id);
  return task.worktreePath ?? repo.path;
}

export function resolveWorkspace(
  state: ShinsaState,
  world: WorkspaceWorld,
  run: Run,
  task: Task
): Workspace | null {
  if (task.repoId === null) {
    return {
      cwd: resolveScratchPath(world.config.dataDir, task.id),
      repo: null,
      defaultBranch: SCRATCH_BRANCH,
    };
  }
  const repo = state.repos[task.repoId];
  const cwd = repo ? resolveCwd(world, run, task, repo) : null;
  return repo && cwd ? { cwd, repo, defaultBranch: repo.defaultBranch } : null;
}

export function isSharedCheckout(run: Run, workspace: Workspace) {
  if (!workspace.repo) return true;
  return workspace.cwd === workspace.repo.path || run.delegation?.isolation === 'shared';
}

export const prepareWorkspace = Effect.fn('RunSupervisor.prepareWorkspace')(function* (workspace: Workspace) {
  if (workspace.repo) return workspace;
  yield* Effect.try({
    try: () => mkdirSync(workspace.cwd, { recursive: true }),
    catch: (error) => new WorkspaceUnavailable({ message: describeError(error) }),
  });
  return workspace;
});

export const prepareIsolation = Effect.fn('RunSupervisor.prepareIsolation')(function* (
  run: DelegatedRun,
  repo: Repo | null
) {
  const baseCommit = run.delegation.baseCommit;
  if (!repo || run.delegation.isolation !== 'worktree' || !baseCommit) return;
  const { worktreeRoot } = yield* RunWorld;
  const worktreesDir = yield* assertWorktreeRoot(worktreeRoot.resolve()).pipe(
    Effect.mapError((unavailable) => new IsolationFailed({ message: unavailable.message }))
  );
  yield* Effect.tryPromise({
    try: () => createIsolatedWorktree(repo, worktreesDir, run.taskId, run.id, baseCommit),
    catch: (error) =>
      new IsolationFailed({ message: `Shinsa could not set up its own checkout: ${describeError(error)}` }),
  });
});
