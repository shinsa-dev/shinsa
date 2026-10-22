import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { log } from '../log/index.ts';
import { describeFailure, runCommand, runCommandOrThrow } from '../shell/index.ts';
import { assertRefName, slugify } from './refs.ts';

export const GIT_NETWORK_TIMEOUT_MS = 2 * 60 * 1000;

const INSTALLERS: { lockfiles: string[]; command: string[] }[] = [
  { lockfiles: ['bun.lock', 'bun.lockb'], command: ['bun', 'install'] },
  { lockfiles: ['pnpm-lock.yaml'], command: ['pnpm', 'install', '--frozen-lockfile'] },
  { lockfiles: ['package-lock.json'], command: ['npm', 'ci'] },
];

async function isBranchTaken(repo: Repo, branch: string) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const exists = await runCommand(['git', 'show-ref', '--verify', '--quiet', ref], repo.path);
    if (exists.ok) return true;
  }
  return false;
}

export async function resolveFreeBranch(repo: Repo, branch: string) {
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? branch : `${branch}-${attempt}`;
    if (!(await isBranchTaken(repo, candidate))) return candidate;
  }
  return `${branch}-${Date.now()}`;
}

export async function resolveStartPoint(repo: Repo, baseBranch: string | null) {
  if (baseBranch) return assertRefName(baseBranch);
  const branch = assertRefName(repo.defaultBranch);
  await runCommand(['git', 'fetch', '--quiet', 'origin', '--', branch], repo.path, {
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });
  const remoteBase = await runCommand(
    ['git', 'rev-parse', '--verify', '--quiet', `origin/${branch}`],
    repo.path
  );
  return remoteBase.ok ? `origin/${branch}` : branch;
}

export async function prepareWorktree(path: string) {
  const installer = INSTALLERS.find((candidate) =>
    candidate.lockfiles.some((lockfile) => existsSync(join(path, lockfile)))
  );
  if (!installer) return;
  const result = await runCommand(installer.command, path);
  if (!result.ok) {
    log.warn('[Git] Installing dependencies failed; the agent sets them up', {
      path,
      error: describeFailure(installer.command, result),
    });
  }
}

export async function createWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  branch: string,
  baseBranch: string | null
) {
  const base = await resolveStartPoint(repo, baseBranch);
  const freeBranch = await resolveFreeBranch(repo, assertRefName(branch));
  const path = join(worktreesDir, slugify(repo.name, 30), `${slugify(freeBranch, 50)}-${taskId.slice(-6)}`);
  await runCommandOrThrow(['git', 'worktree', 'add', '--no-track', '-b', freeBranch, path, base], repo.path);
  await prepareWorktree(path);
  return { path, branch: freeBranch };
}

export async function refreshWorktree(repo: Repo, path: string) {
  const base = await resolveStartPoint(repo, null);
  await runCommandOrThrow(['git', 'reset', '--hard', '--quiet', base], path);
  await runCommandOrThrow(['git', 'clean', '-fdq'], path);
  await prepareWorktree(path);
}

export async function removeWorktree(repo: Repo, path: string) {
  if (existsSync(path)) await runCommandOrThrow(['git', 'worktree', 'remove', '--force', path], repo.path);
  await runCommand(['git', 'worktree', 'prune'], repo.path);
}
