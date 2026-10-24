import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WorktreeStrategy } from '../../src/workspaces/worktrees.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { createRound, createTask } from '../helpers/state.ts';

async function startTask() {
  const made = await createGitRepo();
  const strategy = new WorktreeStrategy(createTempDir());
  const checkout = await strategy.prepare(made.repo, createTask({ worktreePath: null }));
  const task = createTask({ worktreePath: checkout.path, branch: checkout.branch, workspace: 'worktrees' });
  return { ...made, strategy, checkout, task };
}

describe('worktrees', () => {
  test('a task gets a worktree of its own on a fresh branch, and commits and pushes from it', async () => {
    const { repo, origin, strategy, checkout, task } = await startTask();
    expect(checkout.branch).toBe('fix/tab-scroll');
    writeFiles(checkout.path, { 'a.txt': 'a\n' });
    const commit = await strategy.commit(repo, task, 'feat: a');
    expect(commit.treeHash).toBe(await git(checkout.path, 'rev-parse', 'HEAD^{tree}'));
    const sha = await strategy.push(repo, task);
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(sha);
    await commit.undo();
    expect(await git(checkout.path, 'status', '--porcelain')).toBe('A  a.txt');
    await git(checkout.path, 'reset', '-q', '--hard');
    const head = await git(checkout.path, 'rev-parse', 'HEAD');
    const nothing = await strategy.commit(repo, task, 'feat: nothing');
    await nothing.undo();
    expect(await git(checkout.path, 'rev-parse', 'HEAD')).toBe(head);
    expect(await (await strategy.claim())()).toBeUndefined();
  });

  test('an untouched worktree is reset, a later round only drops its scratch edits, and work is kept', async () => {
    const { repo, strategy, checkout, task } = await startTask();
    writeFiles(checkout.path, { 'stray.txt': 'x' });
    await strategy.prepare(repo, task);
    expect(existsSync(join(checkout.path, 'stray.txt'))).toBe(false);
    writeFiles(checkout.path, { 'scratch.txt': 'x' });
    const later = { ...task, rounds: [createRound(), createRound({ number: 2, status: 'active' })] };
    await strategy.prepare(repo, later);
    expect(existsSync(join(checkout.path, 'scratch.txt'))).toBe(false);
    writeFiles(checkout.path, { 'kept.txt': 'x' });
    await strategy.prepare(repo, { ...task, phaseReports: [{}] as typeof task.phaseReports });
    expect(existsSync(join(checkout.path, 'kept.txt'))).toBe(true);
  });

  test('a finished task’s worktree is removed; a task without a branch cannot have one', async () => {
    const { repo, strategy, checkout, task } = await startTask();
    await strategy.remove(repo, task);
    expect(existsSync(checkout.path)).toBe(false);
    await strategy.remove(repo, { ...task, worktreePath: null });
    await expect(strategy.prepare(repo, createTask({ branch: null, worktreePath: null }))).rejects.toThrow(
      'The task has no branch yet.'
    );
    await expect(strategy.push(repo, { ...task, worktreePath: null })).rejects.toThrow(
      'The task has no worktree.'
    );
  });
});
