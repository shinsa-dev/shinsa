import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '@shinsa/core';
import { MainCheckoutStrategy } from '../../src/workspaces/main-checkout.ts';
import { WorktreeStrategy } from '../../src/workspaces/worktrees.ts';
import { createGitRepo, createTempDir, git } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

function writer(path: string, text: string) {
  return () => {
    writeFileSync(path, text);
    return true;
  };
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
});
