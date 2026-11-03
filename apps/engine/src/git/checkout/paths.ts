import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { slugify } from '../refs.ts';
import type { RegisteredWorktree } from './schema.ts';

export function resolveWorktreePath(repo: Repo, worktreesDir: string, taskId: string, branch: string) {
  return join(worktreesDir, slugify(repo.name, 30), `${slugify(branch, 50)}-${taskId.slice(-6)}`);
}

export function resolveDelegationFolder(worktreesDir: string, taskId: string) {
  return join(worktreesDir, 'delegations', slugify(taskId, 60));
}

export function resolveIsolatedPath(worktreesDir: string, taskId: string, runId: string) {
  return join(resolveDelegationFolder(worktreesDir, taskId), slugify(runId, 60));
}

export function parseWorktreeList(listed: string): RegisteredWorktree[] {
  return listed.split('\n\n').flatMap((block) => {
    const lines = block.split('\n');
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch =
      lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null;
    return path ? [{ path, branch }] : [];
  });
}

export function listChangedNames(output: string) {
  return output.split('\n').filter((name) => name.length > 0);
}
