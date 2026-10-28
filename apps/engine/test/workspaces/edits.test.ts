import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, Task } from '@shinsa/core';
import { GitButlerStrategy } from '../../src/workspaces/gitbutler.ts';
import { adoptPath, createLedger, LedgerStore, selectOtherOwner } from '../../src/workspaces/ledger.ts';
import { MainCheckoutStrategy } from '../../src/workspaces/main-checkout.ts';
import { WorktreeStrategy } from '../../src/workspaces/worktrees.ts';
import { createGitRepo, createTempDir, git, startGitButler, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

function writer(path: string, text: string) {
  return () => {
    writeFileSync(path, text);
    return true;
  };
}

async function startButTask(strategy: GitButlerStrategy, repo: Repo, id: string, branch: string) {
  const draft = createTask({ id, branch, worktreePath: null, workspace: 'gitbutler' });
  const checkout = await strategy.prepare(repo, draft);
  return createTask({ id, branch: checkout.branch, worktreePath: checkout.path, workspace: 'gitbutler' });
}

describe('your edits from the Code tab, in each place agents work', () => {
  test('a worktree takes the edit as it is', async () => {
    const { repo, path } = await createGitRepo({ files: { 'a.txt': 'a\n' } });
    await new WorktreeStrategy(createTempDir()).writeEdit(
      repo,
      createTask({ worktreePath: path }),
      'a.txt',
      writer(join(path, 'a.txt'), 'b\n')
    );
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('b\n');
  });

  test('the main checkout takes it only while it is on the task’s branch', async () => {
    const { repo, path } = await createGitRepo({ files: { 'a.txt': 'a\n' } });
    const strategy = new MainCheckoutStrategy();
    const checkout = await strategy.prepare(repo, createTask({ branch: 'fix/a', worktreePath: null }));
    const task: Task = createTask({
      branch: checkout.branch,
      worktreePath: path,
      workspace: 'main_checkout',
    });
    await strategy.writeEdit(repo, task, 'a.txt', writer(join(path, 'a.txt'), 'b\n'));
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('b\n');
    await git(path, 'checkout', '-q', '-f', 'main');
    await expect(strategy.writeEdit(repo, task, 'a.txt', writer(join(path, 'a.txt'), 'c\n'))).rejects.toThrow(
      'The checkout is on main, not on the task’s branch fix/a.'
    );
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('a\n');
  });

  test('in GitButler the edit becomes the task’s, goes into its next commit, and never mixes with another task’s', async () => {
    const made = await createGitRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
    await startGitButler(made.path);
    const strategy = new GitButlerStrategy(createTempDir());
    const first = await startButTask(strategy, made.repo, 'task-1', 'fix/a');
    const second = await startButTask(strategy, made.repo, 'task-2', 'fix/b');
    await strategy.writeEdit(made.repo, first, 'a.txt', writer(join(made.path, 'a.txt'), 'a, by you\n'));
    await strategy.writeEdit(made.repo, first, 'b.txt', () => false);
    const release = await strategy.claim(made.repo, second);
    writeFiles(made.path, { 'b.txt': 'b, by the agent\n' });
    await release();
    await expect(
      strategy.writeEdit(made.repo, first, 'b.txt', writer(join(made.path, 'b.txt'), 'b, by you\n'))
    ).rejects.toThrow('Another task has uncommitted changes in b.txt');
    expect(readFileSync(join(made.path, 'b.txt'), 'utf8')).toBe('b, by the agent\n');
    await strategy.commit(made.repo, first, 'fix: your edit');
    expect(await git(made.path, 'show', 'fix/a:a.txt')).toBe('a, by you');
    expect(await git(made.path, 'show', '--name-only', '--format=', 'fix/a')).toBe('a.txt');
  });

  test('the ledger gives a path to the task, or lets it go once it is clean again', () => {
    const owned = adoptPath(createLedger(), 'task-1', 'a.txt', { 'a.txt': 'hash' });
    expect(owned.owners).toEqual({ 'a.txt': { taskId: 'task-1', hash: 'hash' } });
    expect(selectOtherOwner(owned, 'task-2', 'a.txt')).toBe('task-1');
    expect(selectOtherOwner(owned, 'task-1', 'a.txt')).toBeNull();
    expect(selectOtherOwner(owned, 'task-2', 'b.txt')).toBeNull();
    expect(adoptPath(owned, 'task-1', 'a.txt', {}).owners).toEqual({});
    expect(new LedgerStore(createTempDir()).read('repo')).toEqual(createLedger());
  });
});
