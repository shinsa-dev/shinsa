import { WORKSPACE_SETUP_REASON } from '../domain/index.ts';
import type { Decider } from './decider.ts';

export function requestWorkspace(decider: Decider, taskId: string) {
  decider.stage(taskId, 'triage', WORKSPACE_SETUP_REASON);
  decider.run({ kind: 'worktree.create', taskId });
}
