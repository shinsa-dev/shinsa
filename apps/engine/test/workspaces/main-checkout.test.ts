import { describe, expect, spyOn, test } from 'bun:test';
import type { Task } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { MainCheckoutStrategy } from '../../src/workspaces/main-checkout.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const strategy = new MainCheckoutStrategy();

async function startTask(branch = 'fix/scroll', from?: string) {
  const made = await createGitRepo({ files: { 'a.txt': 'a\n' } });
  if (from) await git(made.path, 'checkout', '-q', '-b', from);
  const checkout = await strategy.prepare(made.repo, createTask({ branch, worktreePath: null }));
  const task: Task = createTask({
    branch: checkout.branch,
    worktreePath: checkout.path,
    workspace: 'main_checkout',
    ...(checkout.returnBranch ? { returnBranch: checkout.returnBranch } : {}),
  });
  return { ...made, task, checkout };
}

function readBranch(path: string) {
  return git(path, 'branch', '--show-current');
}

describe('the main checkout', () => {
  test('the agent works in your checkout, on a branch Shinsa made from the default branch', async () => {
    const { path, checkout, origin } = await startTask();
    expect(checkout).toEqual({ path, branch: 'fix/scroll', returnBranch: 'main' });
    expect(await readBranch(path)).toBe('fix/scroll');
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(await git(origin, 'rev-parse', 'main'));
    expect(await git(path, 'config', '--get', 'branch.fix/scroll.merge').catch(() => 'none')).toBe('none');
  });

  test('a phase is committed on the task’s branch, and undo takes the commit back', async () => {
    const { repo, path, task } = await startTask();
    writeFiles(path, { 'a.txt': 'a, fixed\n' });
    const commit = await strategy.commit(repo, task, 'fix: a');
    expect(commit.treeHash).toBe(await git(path, 'rev-parse', 'HEAD^{tree}'));
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: a');
    await commit.undo();
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(await git(path, 'rev-parse', 'main'));
    const nothing = await strategy.commit(repo, task, 'fix: nothing new');
    await nothing.undo();
    expect(await git(path, 'status', '--porcelain')).toBe('M  a.txt');
  });

  test('nothing is committed once you moved the checkout to another branch', async () => {
    const { repo, path, task } = await startTask();
    await git(path, 'checkout', '-q', 'main');
    await expect(strategy.commit(repo, task, 'fix: a')).rejects.toThrow(
      'The checkout is on main, not on the task’s branch fix/scroll. Switch it back to fix/scroll, then retry.'
    );
    await git(path, 'checkout', '-q', '--detach');
    await expect(strategy.commit(repo, task, 'fix: a')).rejects.toThrow(
      'The checkout is on a detached commit'
    );
  });

  test('your uncommitted work stops a new task before it switches anything', async () => {
    const { repo, path } = await createGitRepo();
    writeFiles(path, { 'mine.txt': 'mine\n' });
    await expect(strategy.prepare(repo, createTask({ worktreePath: null }))).rejects.toThrow(
      `The checkout at ${path} has uncommitted changes. Commit or stash them first: agents work there on a branch of their own and would take them along.`
    );
    expect(await readBranch(path)).toBe('main');
    await expect(strategy.prepare(repo, createTask({ branch: null, worktreePath: null }))).rejects.toThrow(
      'The task has no branch yet.'
    );
  });

  test('a task that already has the checkout keeps it, or switches back to its branch when it is clean', async () => {
    const { repo, path, task } = await startTask();
    expect(await strategy.prepare(repo, task)).toEqual({ path, branch: 'fix/scroll' });
    await git(path, 'checkout', '-q', 'main');
    expect(await strategy.prepare(repo, task)).toEqual({ path, branch: 'fix/scroll' });
    expect(await readBranch(path)).toBe('fix/scroll');
  });

  test('a branch name already taken gets a number', async () => {
    const { repo, path } = await createGitRepo();
    await git(path, 'branch', 'fix/scroll');
    const checkout = await strategy.prepare(repo, createTask({ branch: 'fix/scroll', worktreePath: null }));
    expect(checkout.branch).toBe('fix/scroll-2');
  });

  test('pushes the task’s branch even when the checkout is elsewhere, and answers its commit', async () => {
    const { repo, path, origin, task } = await startTask();
    writeFiles(path, { 'a.txt': 'a, fixed\n' });
    await strategy.commit(repo, task, 'fix: a');
    await git(path, 'checkout', '-q', 'main');
    const sha = await strategy.push(repo, task);
    expect(sha).toBe(await git(path, 'rev-parse', 'fix/scroll'));
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/scroll')).toBe(sha);
  });

  test('a finished task gives the checkout back on the default branch, unless you left work in it', async () => {
    const { repo, path, task } = await startTask();
    writeFiles(path, { 'a.txt': 'a, unfinished\n' });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await strategy.remove(repo, task);
    expect(warn).toHaveBeenCalledWith(
      '[Workspaces] Left the checkout on the task’s branch: it has uncommitted changes',
      { taskId: 'task-1', path }
    );
    warn.mockRestore();
    expect(await readBranch(path)).toBe('fix/scroll');
    await git(path, 'checkout', '--', 'a.txt');
    await strategy.remove(repo, task);
    expect(await readBranch(path)).toBe('main');
    await git(path, 'checkout', '-q', 'fix/scroll');
    await git(path, 'checkout', '-q', '-b', 'mine');
    await strategy.remove(repo, task);
    expect(await readBranch(path)).toBe('mine');
  });

  test('gives the checkout back on the branch it was on when the task took it', async () => {
    const { repo, path, task, checkout } = await startTask('fix/scroll', 'feat/mine');
    expect(checkout.returnBranch).toBe('feat/mine');
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(await git(path, 'rev-parse', 'main'));
    await strategy.remove(repo, task);
    expect(await readBranch(path)).toBe('feat/mine');
  });

  test('falls back to the default branch when the branch it was on is gone, and says so', async () => {
    const { repo, path, task } = await startTask('fix/scroll', 'feat/gone');
    await git(path, 'branch', '-q', '-D', 'feat/gone');
    const info = spyOn(log, 'info').mockImplementation(() => undefined);
    try {
      await strategy.remove(repo, task);
      expect(info).toHaveBeenCalledWith(
        '[Workspaces] The branch the checkout was on is gone, so it goes back to the default branch',
        { taskId: 'task-1', branch: 'feat/gone', defaultBranch: 'main' }
      );
    } finally {
      info.mockRestore();
    }
    expect(await readBranch(path)).toBe('main');
  });

  test('a detached checkout, or one recorded on the task’s own branch, goes back to the default branch', async () => {
    const made = await createGitRepo({ files: { 'a.txt': 'a\n' } });
    await git(made.path, 'checkout', '-q', '--detach');
    const checkout = await strategy.prepare(
      made.repo,
      createTask({ branch: 'fix/scroll', worktreePath: null })
    );
    expect(checkout).toEqual({ path: made.path, branch: 'fix/scroll' });
    const task = createTask({
      branch: 'fix/scroll',
      worktreePath: made.path,
      workspace: 'main_checkout',
      returnBranch: 'fix/scroll',
    });
    await strategy.remove(made.repo, task);
    expect(await readBranch(made.path)).toBe('main');
  });
});
