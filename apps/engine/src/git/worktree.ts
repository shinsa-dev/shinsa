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

async function isFreeBranch(repo: Repo, branch: string, head: string | null, signal?: AbortSignal) {
  if (!(await isBranchTaken(repo, branch, signal))) return true;
  return head !== null && (await isLeftBehind(repo, branch, head, signal));
}

export async function resolveFreeBranch(
  repo: Repo,
  branch: string,
  signal?: AbortSignal,
  head: string | null = null
) {
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? branch : `${branch}-${attempt}`;
    if (await isFreeBranch(repo, candidate, head, signal)) return candidate;
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

async function listRegisteredWorktrees(repo: Repo, signal?: AbortSignal) {
  const listed = await runCommandOrThrow(['git', 'worktree', 'list', '--porcelain'], repo.path, { signal });
  return listed.split('\n\n').flatMap((block) => {
    const lines = block.split('\n');
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch =
      lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null;
    return path ? [{ path, branch }] : [];
  });
}

async function selectRegisteredWorktree(repo: Repo, path: string, signal?: AbortSignal) {
  const registered = await listRegisteredWorktrees(repo, signal);
  return registered.find((worktree) => isSamePath(worktree.path, path)) ?? null;
}

async function isLeftBehind(repo: Repo, branch: string, head: string, signal?: AbortSignal) {
  const ref = `refs/heads/${branch}`;
  const tip = await runCommand(['git', 'rev-parse', '--verify', '--quiet', ref], repo.path, { signal });
  if (!tip.ok || tip.stdout !== head) return false;
  const remote = await runCommand(
    ['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
    repo.path,
    {
      signal,
    }
  );
  if (remote.ok) return false;
  const registered = await listRegisteredWorktrees(repo, signal);
  return registered.every((worktree) => worktree.branch !== branch);
}

async function nameWorktree(repo: Repo, path: string, branch: string, signal?: AbortSignal) {
  const head = await runCommandOrThrow(['git', 'rev-parse', 'HEAD'], path, { signal });
  const name = await resolveFreeBranch(repo, branch, signal, head);
  await runGitOrThrow(['checkout', '--quiet', '-B', name], path, { signal });
  return name;
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
  const registered = await selectRegisteredWorktree(repo, path, signal);
  if (registered?.branch) {
    await prepareWorktree(path, signal);
    return { path, branch: registered.branch };
  }
  if (!registered) {
    rmSync(path, { recursive: true, force: true });
    await runCommand(['git', 'worktree', 'prune'], repo.path, { signal });
    const base = await resolveStartPoint(repo, baseBranch, signal);
    await runGitOrThrow(['worktree', 'add', '--detach', path, base], repo.path, { signal });
  }
  const named = await nameWorktree(repo, path, branch, signal);
  await prepareWorktree(path, signal);
  return { path, branch: named };
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
  if (existsSync(path)) await runCommand(['git', 'worktree', 'remove', '--force', path], repo.path);
  rmSync(path, { recursive: true, force: true });
  await runCommand(['git', 'worktree', 'prune'], repo.path);
}
