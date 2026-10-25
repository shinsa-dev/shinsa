import type { Repo, Task } from './types.ts';

export const WORKSPACE_MODES = ['worktrees', 'gitbutler', 'main_checkout'] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'worktrees';

export const WORKSPACE_SETUP_REASON: Record<WorkspaceMode, string> = {
  worktrees: 'setting up the worktree',
  gitbutler: 'setting up the branch',
  main_checkout: 'setting up the checkout',
};

const SETUP_REASONS: ReadonlySet<string> = new Set(Object.values(WORKSPACE_SETUP_REASON));

export interface WorkspaceSupport {
  butInstalled: boolean;
  gitButlerWorkspace: boolean;
}

export function resolveRepoWorkspace(repo: Pick<Repo, 'workspace'> | null | undefined): WorkspaceMode {
  return repo?.workspace ?? DEFAULT_WORKSPACE_MODE;
}

export function isSettingUpWorkspace(task: Pick<Task, 'stage' | 'stageReason'>) {
  return task.stage === 'triage' && SETUP_REASONS.has(task.stageReason);
}

export function isSharedWorkspace(mode: WorkspaceMode) {
  return mode !== 'worktrees';
}

export function canUseGitButler(support: WorkspaceSupport) {
  return support.butInstalled && support.gitButlerWorkspace;
}

export function resolveEditRefusal(task: Pick<Task, 'stage' | 'closedAt' | 'worktreePath'>): string | null {
  if (task.stage === 'merged') return 'This task is merged, so its code is read-only.';
  if (task.stage === 'cancelled' || (task.closedAt ?? null) !== null)
    return 'This task is finished, so its code is read-only.';
  if (!task.worktreePath) return 'This task has no checkout to edit, so its code is read-only.';
  return null;
}

export function describeHumanEdits(paths: readonly string[]) {
  return [
    `The human edited ${paths.length === 1 ? 'this file' : 'these files'} in the working copy: ${paths.join(', ')}.`,
    'Their edits are part of the work and go into your next commit: keep them, and read a file again before you change it.',
  ].join(' ');
}
