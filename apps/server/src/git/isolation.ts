import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { log } from '../log/index.ts';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import { slugify } from './refs.ts';
import { runGitOrThrow } from './run.ts';
import { prepareWorktree } from './worktree.ts';

const COMMIT = /^[0-9a-f]{7,64}$/;

function resolveTaskFolder(worktreesDir: string, taskId: string) {
  return join(worktreesDir, 'delegations', slugify(taskId, 60));
}

export function resolveIsolatedPath(worktreesDir: string, taskId: string, runId: string) {
  return join(resolveTaskFolder(worktreesDir, taskId), slugify(runId, 60));
}

async function isRegistered(repo: Repo, path: string) {
  const listed = await runCommandOrThrow(['git', 'worktree', 'list', '--porcelain'], repo.path);
  const real = realpathSync(path);
  return listed
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .some((line) => {
      const candidate = line.slice('worktree '.length);
      return existsSync(candidate) && realpathSync(candidate) === real;
    });
}

export async function createIsolatedWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  runId: string,
  baseCommit: string
) {
  if (!COMMIT.test(baseCommit)) throw new Error(`"${baseCommit}" is not a commit Shinsa will pass to git.`);
  const path = resolveIsolatedPath(worktreesDir, taskId, runId);
  if (existsSync(path) && (await isRegistered(repo, path))) return path;
  rmSync(path, { recursive: true, force: true });
  await runCommand(['git', 'worktree', 'prune'], repo.path);
  await runGitOrThrow(['worktree', 'add', '--detach', path, baseCommit], repo.path);
  await prepareWorktree(path);
  return path;
}

export async function describeIsolatedChanges(path: string) {
  const status = await runCommand(['git', 'status', '--porcelain'], path);
  if (!status.ok) return null;
  return status.stdout.split('\n').filter((line) => line.trim().length > 0).length;
}

export async function removeIsolatedWorktrees(repo: Repo, worktreesDir: string, taskId: string) {
  const folder = resolveTaskFolder(worktreesDir, taskId);
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    const removed = await runCommand(['git', 'worktree', 'remove', '--force', path], repo.path);
    if (!removed.ok) {
      log.warn('[Git] Could not remove a delegated task’s checkout; deleting the folder', {
        path,
        error: removed.stderr.trim(),
      });
    }
  }
  rmSync(folder, { recursive: true, force: true });
  await runCommand(['git', 'worktree', 'prune'], repo.path);
}
