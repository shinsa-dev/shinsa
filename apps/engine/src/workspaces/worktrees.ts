import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { EdgeWorkspace } from './edge.ts';
import type { WorktreeRoot } from './root/index.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export class WorktreeStrategy extends EdgeWorkspace {
  constructor(root: WorktreeRoot) {
    super(edgeRuntime.runSync(WorktreeWorkspaces.use((worktrees) => Effect.succeed(worktrees.make(root)))));
  }
}
