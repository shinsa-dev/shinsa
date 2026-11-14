import { Option } from 'effect';
import { hasStep } from './shapes.ts';
import type { Task } from './types.ts';

export const WORKSPACE_SETUP_REASON = 'setting up the worktree';

export function isSettingUpWorkspace(task: Pick<Task, 'stage' | 'stageReason'>) {
  return task.stage === 'triage' && task.stageReason === WORKSPACE_SETUP_REASON;
}

export function resolveEditRefusal(
  task: Pick<Task, 'stage' | 'closedAt' | 'worktreePath'>
): Option.Option<string> {
  if (task.stage === 'merged') return Option.some('This task is merged, so its code is read-only.');
  if (task.stage === 'cancelled' || (task.closedAt ?? null) !== null)
    return Option.some('This task is finished, so its code is read-only.');
  if (!task.worktreePath) return Option.some('This task has no checkout to edit, so its code is read-only.');
  return Option.none();
}

export function describeHumanEdits(paths: readonly string[]) {
  return [
    `The human edited ${paths.length === 1 ? 'this file' : 'these files'} in the working copy: ${paths.join(', ')}.`,
    'Their edits are part of the work and go into your next commit: keep them, and read a file again before you change it.',
  ].join(' ');
}

export type ApprovalPath = 'check_edits' | 'open' | 'push' | 'push_edits' | 'merge';

export function resolveApprovalPath(
  task: Pick<Task, 'editedPaths' | 'pipeline' | 'mode' | 'pullRequest'>,
  gate: 'review' | 'merge'
): ApprovalPath {
  const edited = (task.editedPaths ?? []).length > 0;
  if (gate === 'merge') return edited ? 'push_edits' : 'merge';
  if (edited && hasStep(task, 'checks')) return 'check_edits';
  return task.pullRequest ? 'push' : 'open';
}
