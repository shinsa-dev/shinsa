import { needsWorktree, resolveTaskPipeline, WORKSPACE_SETUP_REASON } from '../domain/index.ts';
import { resolveTaskWorkspace, selectCheckoutHolder } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';

export function holdForCheckout(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!needsWorktree(resolveTaskPipeline(task)) || task.worktreePath !== null) return false;
  if (resolveTaskWorkspace(decider.state, task) !== 'main_checkout') return false;
  const holder = selectCheckoutHolder(decider.state, task);
  if (!holder) return false;
  decider.stage(
    taskId,
    'waiting_on_tasks',
    `waiting for ${quoteTitles([holder])} to finish with the checkout`
  );
  return true;
}

export function requestWorkspace(decider: Decider, taskId: string) {
  if (holdForCheckout(decider, taskId)) return;
  const task = decider.task(taskId);
  const workspace = resolveTaskWorkspace(decider.state, task);
  if (task.workspace !== workspace) decider.emit({ type: 'worktree.requested', taskId, workspace });
  decider.stage(taskId, 'triage', WORKSPACE_SETUP_REASON[workspace]);
  decider.run({ kind: 'worktree.create', taskId });
}
