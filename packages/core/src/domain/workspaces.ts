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
