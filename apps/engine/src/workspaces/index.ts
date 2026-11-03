import { DEFAULT_WORKSPACE_MODE, type Repo, type Task, type WorkspaceMode } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { MainCheckoutWorkspace } from './main-checkout-mode/service.ts';
import { MainCheckoutStrategy } from './main-checkout.ts';
import type { WorkspaceStrategy, WorkspacesOptions } from './schema.ts';
import { WorktreeStrategy } from './worktrees.ts';

export type { WorkspaceStrategy, WorkspacesOptions } from './schema.ts';

export function describeWorkspaceProblem(
  repo: Repo,
  mode: WorkspaceMode,
  holdsCheckout: boolean,
  signal?: AbortSignal
) {
  return edgeRuntime.runPromise(
    MainCheckoutWorkspace.use((main) => main.describeProblem(repo, mode, holdsCheckout, signal))
  );
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
