import { DEFAULT_WORKSPACE_MODE, type Task, type WorkspaceMode } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../config/service.ts';
import { MainCheckoutWorkspace } from './main-checkout-mode/service.ts';
import type { Workspace } from './schema.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export class Workspaces extends Context.Service<
  Workspaces,
  {
    resolve(task: Pick<Task, 'workspace'>): Workspace;
    readonly describeProblem: MainCheckoutWorkspace['Service']['describeProblem'];
  }
>()('shinsa/engine/workspaces/Workspaces') {
  static readonly layer = Layer.effect(
    Workspaces,
    Effect.gen(function* () {
      const { worktreesDir } = yield* EngineConfig;
      const main = yield* MainCheckoutWorkspace;
      const strategies: Record<WorkspaceMode, Workspace> = {
        worktrees: (yield* WorktreeWorkspaces).make(worktreesDir),
        main_checkout: main.workspace,
      };
      return Workspaces.of({
        resolve: (task) => strategies[task.workspace ?? DEFAULT_WORKSPACE_MODE],
        describeProblem: main.describeProblem,
      });
    })
  );
}
