import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { resolveIsolatedPath } from '../../src/git/checkout/paths.ts';
import { Checkout } from '../../src/git/checkout/service.ts';
import { runGit } from '../helpers/git.ts';
import { captureLogs, createGitRepo, createTempDir, git } from '../helpers/index.ts';

setDefaultTimeout(30_000);

const resolveHead = (path: string) => runGit(Checkout.use((checkout) => checkout.head(path)));
const createIsolatedWorktree = (
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  runId: string,
  baseCommit: string
) =>
  runGit(Checkout.use((checkout) => checkout.createIsolated(repo, worktreesDir, taskId, runId, baseCommit)));
const describeIsolatedChanges = (path: string) =>
  runGit(Checkout.use((checkout) => checkout.describeIsolated(path)));
const removeIsolatedWorktrees = (repo: Repo, worktreesDir: string, taskId: string) =>
  runGit(Checkout.use((checkout) => checkout.removeIsolated(repo, worktreesDir, taskId)));

async function createCheckoutRepo() {
  const { repo, path } = await createGitRepo({ remote: false, files: { 'a.txt': 'one\n' } });
  const head = await resolveHead(path);
  await git(path, 'commit', '-q', '--allow-empty', '-m', 'chore: later');
  return { repo, path, head, worktreesDir: createTempDir('shinsa-worktrees-') };
}

describe('a delegation’s own checkout', () => {
  test('is made from the given commit, detached, under the task’s folder', async () => {
    const { repo, head, worktreesDir } = await createCheckoutRepo();
    const path = await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head);
    expect(path).toBe(resolveIsolatedPath(worktreesDir, 'task-1', 'run-1'));
    expect(path).toBe(join(worktreesDir, 'delegations', 'task-1', 'run-1'));
    expect(await resolveHead(path)).toBe(head);
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('one\n');
    expect(await git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
  });

  test('is reused when it already exists, and remade when only a stray folder is left', async () => {
    const { repo, head, worktreesDir } = await createCheckoutRepo();
    const path = await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head);
    writeFileSync(join(path, 'b.txt'), 'kept\n');
    expect(await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head)).toBe(path);
    expect(existsSync(join(path, 'b.txt'))).toBe(true);
    const stray = resolveIsolatedPath(worktreesDir, 'task-1', 'run-2');
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, 'junk.txt'), 'junk');
    await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-2', head);
    expect(existsSync(join(stray, 'junk.txt'))).toBe(false);
    expect(existsSync(join(stray, 'a.txt'))).toBe(true);
  });

  test('refuses anything that is not a commit id', async () => {
    const { repo, worktreesDir } = await createCheckoutRepo();
    await expect(createIsolatedWorktree(repo, worktreesDir, 't', 'r', '--upload-pack=x')).rejects.toThrow(
      '"--upload-pack=x" is not a commit Shinsa will pass to git.'
    );
  });

  test('counts the files it changed, or says nothing outside a repository', async () => {
    const { repo, head, worktreesDir } = await createCheckoutRepo();
    const path = await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head);
    expect(await describeIsolatedChanges(path)).toBe(0);
    writeFileSync(join(path, 'a.txt'), 'two\n');
    writeFileSync(join(path, 'new.txt'), 'new\n');
    expect(await describeIsolatedChanges(path)).toBe(2);
    expect(await describeIsolatedChanges(createTempDir())).toBeNull();
  });

  test('every checkout of a task is removed with it, and a folder git cannot remove is deleted anyway', async () => {
    const { repo, head, worktreesDir } = await createCheckoutRepo();
    const first = await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head);
    const loose = resolveIsolatedPath(worktreesDir, 'task-1', 'loose');
    mkdirSync(loose, { recursive: true });
    const logs = captureLogs();
    await removeIsolatedWorktrees(repo, worktreesDir, 'task-1');
    logs.restore();
    expect(existsSync(first)).toBe(false);
    expect(existsSync(join(worktreesDir, 'delegations', 'task-1'))).toBe(false);
    expect(logs.entries.some((entry) => entry.message.includes('delegation’s checkout'))).toBe(true);
    expect(await git(repo.path, 'worktree', 'list')).not.toContain(join('delegations', 'task-1', 'run-1'));
    await removeIsolatedWorktrees(repo, worktreesDir, 'task-2');
  });

  test('a task’s checkouts are removed even when the worktree folder changed since they were made', async () => {
    const { repo, head, worktreesDir } = await createCheckoutRepo();
    const earlier = await createIsolatedWorktree(repo, worktreesDir, 'task-1', 'run-1', head);
    const kept = await createIsolatedWorktree(repo, worktreesDir, 'task-2', 'run-1', head);
    const current = createTempDir('shinsa-worktrees-');
    await removeIsolatedWorktrees(repo, current, 'task-1');
    expect(existsSync(earlier)).toBe(false);
    expect(existsSync(join(worktreesDir, 'delegations', 'task-1'))).toBe(false);
    expect(existsSync(kept)).toBe(true);
    const listed = await git(repo.path, 'worktree', 'list');
    expect(listed).not.toContain(join('delegations', 'task-1'));
    expect(listed).toContain(join('delegations', 'task-2'));
  });
});
