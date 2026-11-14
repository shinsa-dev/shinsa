import { Context, Effect, Layer } from 'effect';
import { WorktreeRoot } from './root/service.ts';
import type { Workspace } from './schema.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export class Workspaces extends Context.Service<
  Workspaces,
  Workspace & { readonly root: WorktreeRoot['Service'] }
>()('shinsa/engine/workspaces/Workspaces') {
  static readonly layer = Layer.effect(
    Workspaces,
    Effect.gen(function* () {
      const root = yield* WorktreeRoot;
      const workspace = (yield* WorktreeWorkspaces).make(root);
      return Workspaces.of({ ...workspace, root });
    })
  );
}
