import {
  type ConfigProblem,
  DEFAULT_WORKSPACE_MODE,
  type Repo,
  type Task,
  type WorkspaceMode,
} from '@shinsa/core';
import { describeDirtyCheckout, isCheckoutClean, MainCheckoutStrategy } from './main-checkout.ts';
import type { WorkspaceStrategy } from './types.ts';
import { WorktreeStrategy } from './worktrees.ts';

export type { WorkspaceStrategy } from './types.ts';

export interface WorkspacesOptions {
  worktreesDir: string;
}

export async function describeWorkspaceProblem(
  repo: Repo,
  mode: WorkspaceMode,
  holdsCheckout: boolean,
  signal?: AbortSignal
): Promise<ConfigProblem | null> {
  if (mode !== 'main_checkout' || holdsCheckout) return null;
  if (!(await isCheckoutClean(repo.path, signal)))
    return { kind: 'workspace', detail: describeDirtyCheckout(repo) };
  return null;
}

export class Workspaces {
  readonly #strategies: Record<WorkspaceMode, WorkspaceStrategy>;

  constructor(options: WorkspacesOptions) {
    this.#strategies = {
      worktrees: new WorktreeStrategy(options.worktreesDir),
      main_checkout: new MainCheckoutStrategy(),
    };
  }

  resolve(task: Pick<Task, 'workspace'>) {
    return this.#strategies[task.workspace ?? DEFAULT_WORKSPACE_MODE];
  }
}
