import { type Repo, resolveRepoWorkspace, WORKSPACE_MODES, type WorkspaceMode } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export interface WorkspaceItem {
  value: WorkspaceMode;
  label: string;
  hint: string;
  icon: MenuItemIcon;
}

export const WORKSPACE_TITLE = 'Where agents work';

const WORKSPACE_COPY: Record<WorkspaceMode, Omit<WorkspaceItem, 'value'>> = {
  worktrees: {
    label: 'Worktrees',
    hint: 'Each task gets a git worktree of its own on a fresh branch.',
    icon: 'IconSplit',
  },
  main_checkout: {
    label: 'Main checkout',
    hint: 'Agents work in this checkout on a branch Shinsa makes, one task at a time.',
    icon: 'IconFolder1',
  },
};

const CHANGED: Record<WorkspaceMode, string> = {
  worktrees: 'A worktree per task',
  main_checkout: 'One task at a time',
};

export function resolveWorkspaceLabel(repo: Pick<Repo, 'workspace'>) {
  return WORKSPACE_COPY[resolveRepoWorkspace(repo)].label;
}

export function listWorkspaceItems(): WorkspaceItem[] {
  return WORKSPACE_MODES.map((mode) => ({ value: mode, ...WORKSPACE_COPY[mode] }));
}

export function describeWorkspaceChange(repo: Pick<Repo, 'name'>, mode: WorkspaceMode) {
  return `${CHANGED[mode]} in ${repo.name}.`;
}

export function changeWorkspace(repo: Repo, mode: WorkspaceMode) {
  if (resolveRepoWorkspace(repo) === mode) return Promise.resolve(true);
  return sendCommandWithToast(
    { type: 'repo.update', repoId: repo.id, patch: { workspace: mode } },
    describeWorkspaceChange(repo, mode)
  );
}

export function resolveRepoKey(repos: Pick<Repo, 'id'>[]) {
  return repos
    .map((repo) => repo.id)
    .sort()
    .join(',');
}
