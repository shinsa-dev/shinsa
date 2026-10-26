import {
  type Repo,
  resolveRepoWorkspace,
  WORKSPACE_MODES,
  type WorkspaceMode,
  type WorkspaceSupport,
} from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { WorkspaceSupportMap } from '@/lib/connection/workspaces.ts';

export interface WorkspaceItem {
  value: WorkspaceMode;
  label: string;
  hint: string;
  icon: MenuItemIcon;
  disabled?: string;
}

export const WORKSPACE_TITLE = 'Where agents work';

const WORKSPACE_COPY: Record<WorkspaceMode, Omit<WorkspaceItem, 'value' | 'disabled'>> = {
  worktrees: {
    label: 'Worktrees',
    hint: 'Each task gets a git worktree of its own on a fresh branch.',
    icon: 'IconSplit',
  },
  gitbutler: {
    label: 'GitButler',
    hint: 'Each task gets a branch of its own in your GitButler workspace, applied with the others so you can test them together.',
    icon: 'IconLayersThree',
  },
  main_checkout: {
    label: 'Main checkout',
    hint: 'Agents work in this checkout on a branch Shinsa makes, one task at a time.',
    icon: 'IconFolder1',
  },
};

const CHANGED: Record<WorkspaceMode, string> = {
  worktrees: 'get a worktree each',
  gitbutler: 'get a branch each in the GitButler workspace',
  main_checkout: 'work in its checkout, one at a time',
};

export function describeGitButlerSupport(support: WorkspaceSupport | undefined) {
  if (!support) return 'Checking whether GitButler is set up here.';
  if (!support.butInstalled) return 'Install GitButler’s command line (`but`) to use it.';
  if (!support.gitButlerWorkspace) return 'Run `but setup` in this repository to use it.';
  return null;
}

export function resolveWorkspaceLabel(repo: Pick<Repo, 'workspace'>) {
  return WORKSPACE_COPY[resolveRepoWorkspace(repo)].label;
}

export function listWorkspaceItems(repo: Repo, support: WorkspaceSupportMap | null): WorkspaceItem[] {
  const current = resolveRepoWorkspace(repo);
  const repoSupport = support?.[repo.id];
  return WORKSPACE_MODES.map((mode) => {
    const reason = mode === 'gitbutler' && mode !== current ? describeGitButlerSupport(repoSupport) : null;
    return { value: mode, ...WORKSPACE_COPY[mode], ...(reason ? { disabled: reason } : {}) };
  });
}

export function describeWorkspaceChange(repo: Pick<Repo, 'name'>, mode: WorkspaceMode) {
  return `New tasks in ${repo.name} ${CHANGED[mode]}. Tasks already working keep where they are.`;
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
