import {
  type ConfigProblem,
  DEFAULT_WORKSPACE_MODE,
  type Repo,
  type Task,
  type WorkspaceMode,
  type WorkspaceSupport,
} from '@shinsa/core';
import { isButInstalled, isGitButlerWorkspace } from './but.ts';
import { describeNotWorkspace, GitButlerStrategy } from './gitbutler.ts';
import { describeDirtyCheckout, isCheckoutClean, MainCheckoutStrategy } from './main-checkout.ts';
import type { WorkspaceStrategy } from './types.ts';
import { WorktreeStrategy } from './worktrees.ts';

export { ConflictedBranchError, type ReleaseClaim, type WorkspaceStrategy } from './types.ts';

export interface WorkspacesOptions {
  dataDir: string;
  worktreesDir: string;
}

export async function listWorkspaceSupport(repos: Pick<Repo, 'id' | 'path'>[]) {
  const butInstalled = await isButInstalled();
  const support: Record<string, WorkspaceSupport> = {};
  for (const repo of repos) {
    support[repo.id] = { butInstalled, gitButlerWorkspace: isGitButlerWorkspace(repo.path) };
  }
  return support;
}

export async function describeWorkspaceProblem(
  repo: Repo,
  mode: WorkspaceMode,
  holdsCheckout: boolean,
  signal?: AbortSignal
): Promise<ConfigProblem | null> {
  if (mode === 'gitbutler') {
    if (!(await isButInstalled(signal))) {
      return {
        kind: 'workspace',
        detail:
          'Agents work on GitButler branches here, but GitButler’s command line (`but`) is not installed.',
      };
    }
    if (!isGitButlerWorkspace(repo.path)) return { kind: 'workspace', detail: describeNotWorkspace(repo) };
    return null;
  }
  if (mode !== 'main_checkout' || holdsCheckout) return null;
  if (isGitButlerWorkspace(repo.path)) {
    return {
      kind: 'workspace',
      detail: `${repo.name} is a GitButler workspace, so agents cannot switch its checkout to a branch of their own.`,
    };
  }
  if (!(await isCheckoutClean(repo.path, signal)))
    return { kind: 'workspace', detail: describeDirtyCheckout(repo) };
  return null;
}

export class Workspaces {
  readonly #strategies: Record<WorkspaceMode, WorkspaceStrategy>;

  constructor(options: WorkspacesOptions) {
    this.#strategies = {
      worktrees: new WorktreeStrategy(options.worktreesDir),
      gitbutler: new GitButlerStrategy(options.dataDir),
      main_checkout: new MainCheckoutStrategy(),
    };
  }

  resolve(task: Pick<Task, 'workspace'>) {
    return this.#strategies[task.workspace ?? DEFAULT_WORKSPACE_MODE];
  }
}
