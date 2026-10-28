import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../../src/shell/index.ts';
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
    writeFiles(checkout.path, { 'a.txt': 'a\n', 'docs/ä b.md': 'b\n' });
    const commit = await strategy.commit(repo, task, 'feat: a');
    expect(commit.treeHash).toBe(await git(checkout.path, 'rev-parse', 'HEAD^{tree}'));
    expect(commit.files).toEqual(['a.txt', 'docs/ä b.md']);
    const sha = await strategy.push(repo, task);
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(sha);
    await commit.undo();
    expect(await git(checkout.path, 'status', '--porcelain')).toContain('A  a.txt');
    await git(checkout.path, 'reset', '-q', '--hard');
    const head = await git(checkout.path, 'rev-parse', 'HEAD');
    const nothing = await strategy.commit(repo, task, 'feat: nothing');
    expect(nothing.files).toEqual([]);
    await nothing.undo();
    expect(await git(checkout.path, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('a resolved merge of the base is committed as git’s merge, and undo puts it back in progress', async () => {
    const { repo, path, strategy, checkout, task } = await startTask();
    writeFiles(checkout.path, { 'a.txt': 'task\n' });
    await strategy.commit(repo, task, 'feat: a');
    writeFiles(path, { 'a.txt': 'main\n' });
    await git(path, 'add', 'a.txt');
    await git(path, 'commit', '-qm', 'main moved');
    await runCommand(['git', 'merge', '--no-edit', 'main'], checkout.path);
    writeFiles(checkout.path, { 'a.txt': 'task\nmain\n' });
    await git(checkout.path, 'add', 'a.txt');

    const commit = await strategy.commit(repo, task, 'fix: resolve conflicts');
    const main = await git(path, 'rev-parse', 'main');
    expect(await git(checkout.path, 'rev-parse', 'HEAD^2')).toBe(main);
    await commit.undo();
    expect(await git(checkout.path, 'rev-parse', 'MERGE_HEAD')).toBe(main);
    await strategy.commit(repo, task, 'fix: resolve conflicts again');
    expect(await git(checkout.path, 'log', '-1', '--format=%s %P')).toBe(
      `Merge branch 'main' into fix/tab-scroll ${await git(checkout.path, 'rev-parse', 'HEAD^1')} ${main}`
    );
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
