import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { resolveInstallCommand } from '../checks/index.ts';
import { log } from '../log/index.ts';
import { describeFailure, runCommand, runCommandOrThrow } from '../shell/index.ts';
import { assertRefName, slugify } from './refs.ts';
import { runGitOrThrow } from './run.ts';

const GIT_NETWORK_TIMEOUT_MS = 2 * 60 * 1000;

async function isBranchTaken(repo: Repo, branch: string, signal?: AbortSignal) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const exists = await runCommand(['git', 'show-ref', '--verify', '--quiet', ref], repo.path, { signal });
    if (exists.ok) return true;
  }
  return false;
}

export async function resolveFreeBranch(repo: Repo, branch: string, signal?: AbortSignal) {
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? branch : `${branch}-${attempt}`;
    if (!(await isBranchTaken(repo, candidate, signal))) return candidate;
  }
  return `${branch}-${Date.now()}`;
}

export function syncRemoteBranch(repo: Repo, branch: string, signal?: AbortSignal) {
  return runCommand(['git', 'fetch', '--quiet', 'origin', '--', assertRefName(branch)], repo.path, {
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
    signal,
  });
}

export async function resolveStartPoint(repo: Repo, baseBranch: string | null, signal?: AbortSignal) {
  if (baseBranch) return assertRefName(baseBranch);
  const branch = assertRefName(repo.defaultBranch);
  await syncRemoteBranch(repo, branch, signal);
  const remoteBase = await runCommand(
    ['git', 'rev-parse', '--verify', '--quiet', `origin/${branch}`],
    repo.path,
    { signal }
  );
  return remoteBase.ok ? `origin/${branch}` : branch;
}

export async function prepareWorktree(path: string, signal?: AbortSignal) {
  const install = resolveInstallCommand(path);
  if (!install) return;
  const result = await runCommand(install, path, { signal });
  if (!result.ok && !signal?.aborted) {
    log.warn('[Git] Installing dependencies failed; the agent sets them up', {
      path,
      error: describeFailure(install, result),
    });
  }
}

function isSamePath(a: string, b: string) {
  return existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b);
}

async function selectRegisteredWorktree(repo: Repo, path: string, signal?: AbortSignal) {
  const listed = await runCommandOrThrow(['git', 'worktree', 'list', '--porcelain'], repo.path, { signal });
  for (const block of listed.split('\n\n')) {
    const lines = block.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch = lines
      .find((line) => line.startsWith('branch refs/heads/'))
      ?.slice('branch refs/heads/'.length);
    if (worktree && branch && isSamePath(worktree, path)) return { path, branch };
  }
  return null;
}

function resolveWorktreePath(repo: Repo, worktreesDir: string, taskId: string, branch: string) {
  return join(worktreesDir, slugify(repo.name, 30), `${slugify(branch, 50)}-${taskId.slice(-6)}`);
}

export async function createWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  branch: string,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  const path = resolveWorktreePath(repo, worktreesDir, taskId, assertRefName(branch));
  if (existsSync(path)) {
    const registered = await selectRegisteredWorktree(repo, path, signal);
    if (registered) {
      await prepareWorktree(path, signal);
      return registered;
    }
    rmSync(path, { recursive: true, force: true });
    await runCommand(['git', 'worktree', 'prune'], repo.path, { signal });
  }
  const base = await resolveStartPoint(repo, baseBranch, signal);
  const freeBranch = await resolveFreeBranch(repo, branch, signal);
  await runGitOrThrow(['worktree', 'add', '--no-track', '-b', freeBranch, path, base], repo.path, { signal });
  await prepareWorktree(path, signal);
  return { path, branch: freeBranch };
}

export async function refreshWorktree(repo: Repo, path: string, signal?: AbortSignal) {
  const base = await resolveStartPoint(repo, null, signal);
  await runGitOrThrow(['reset', '--hard', '--quiet', base], path, { signal });
  await runGitOrThrow(['clean', '-fdq'], path, { signal });
  await prepareWorktree(path, signal);
}

export async function discardEdits(path: string, signal?: AbortSignal) {
  await runGitOrThrow(['reset', '--hard', '--quiet', 'HEAD'], path, { signal });
  await runGitOrThrow(['clean', '-fdq'], path, { signal });
}

export async function removeWorktree(repo: Repo, path: string) {
  if (existsSync(path)) await runGitOrThrow(['worktree', 'remove', '--force', path], repo.path);
  await runCommand(['git', 'worktree', 'prune'], repo.path);
}
