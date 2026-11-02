import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { EdgeWorkspace } from './edge.ts';
import { WorktreeWorkspaces } from './worktrees-mode/service.ts';

export class WorktreeStrategy extends EdgeWorkspace {
  constructor(worktreesDir: string) {
    super(
      edgeRuntime.runSync(WorktreeWorkspaces.use((worktrees) => Effect.succeed(worktrees.make(worktreesDir))))
    );
  }
}
