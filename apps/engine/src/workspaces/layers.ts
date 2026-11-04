import { Layer } from 'effect';
import { MainCheckoutWorkspace } from './main-checkout-mode/service.ts';
import { WorktreeRoot } from './root/service.ts';
import { Workspaces } from './service.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export const WorkspacesLayer = MainCheckoutWorkspace.layer.pipe(Layer.provideMerge(WorktreeWorkspaces.layer));

export const WorkspacesServiceLayer = Workspaces.layer.pipe(
  Layer.provideMerge(Layer.merge(WorkspacesLayer, WorktreeRoot.layer))
);
