import { Layer } from 'effect';
import { WorktreeRoot } from './root/service.ts';
import { Workspaces } from './service.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export const WorkspacesServiceLayer = Workspaces.layer.pipe(
  Layer.provideMerge(Layer.merge(WorktreeWorkspaces.layer, WorktreeRoot.layer))
);
