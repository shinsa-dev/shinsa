import { Layer } from 'effect';
import { MainCheckoutWorkspace } from './main-checkout-mode/service.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export const WorkspacesLayer = MainCheckoutWorkspace.layer.pipe(Layer.provideMerge(WorktreeWorkspaces.layer));
