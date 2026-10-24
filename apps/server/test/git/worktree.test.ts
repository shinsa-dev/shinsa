import { describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  commitWorktree,
  createWorktree,
  refreshWorktree,
  removeWorktree,
  resolveWorkingDiff,
} from '../../src/git/index.ts';
import { prepareWorktree, resolveFreeBranch, resolveStartPoint } from '../../src/git/worktree.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

describe('worktrees', () => {
  test('a task gets its own worktree, its changes diff and commit there', async () => {
    const { repo, path } = await createGitRepo({
      remote: false,
      files: { 'app.ts': 'export const value = 1;\n' },
    });
    const worktrees = createTempDir();
    const worktree = await createWorktree(repo, worktrees, 'task-abcdef', 'fix/value', null);
    expect(worktree.branch).toBe('fix/value');

    writeFileSync(join(worktree.path, 'app.ts'), 'export const value = 2;\n');
    writeFileSync(join(worktree.path, 'new.ts'), 'export const added = true;\n');
    const files = await resolveWorkingDiff(worktree.path, await git(worktree.path, 'rev-parse', 'HEAD'));
    expect(files.map((file) => file.path).sort()).toEqual(['app.ts', 'new.ts']);

    expect(await commitWorktree(worktree.path, 'fix(value): bump to two')).toBe(true);
    expect(await git(worktree.path, 'log', '-1', '--format=%s')).toBe('fix(value): bump to two');

    const second = await createWorktree(repo, worktrees, 'task-123456', 'fix/value', null);
    expect(second.branch).toBe('fix/value-2');

    const stacked = await createWorktree(repo, worktrees, 'task-777777', 'feat/on-top', worktree.branch);
    expect(await git(stacked.path, 'log', '-1', '--format=%s')).toBe('fix(value): bump to two');

    await removeWorktree(repo, worktree.path);
    expect(await git(path, 'worktree', 'list')).not.toContain(worktree.path);
    await removeWorktree(repo, worktree.path);
  });

  test('creating the same task’s worktree again, after a crash, reuses it instead of making a second', async () => {
    const { repo, path } = await createGitRepo({ remote: false });
    const worktrees = createTempDir();
    const first = await createWorktree(repo, worktrees, 'task-abcdef', 'fix/value', null);
    writeFileSync(join(first.path, 'work.txt'), 'kept\n');
    expect(await createWorktree(repo, worktrees, 'task-abcdef', 'fix/value', null)).toEqual(first);
    expect(existsSync(join(first.path, 'work.txt'))).toBe(true);
    expect(await git(path, 'branch', '--format=%(refname:short)')).toBe('fix/value\nmain');
  });

  test('a half-made worktree folder left by a crash is cleared and made again', async () => {
    const { repo, path } = await createGitRepo({ remote: false });
    const worktrees = createTempDir();
    const first = await createWorktree(repo, worktrees, 'task-abcdef', 'fix/value', null);
    await removeWorktree(repo, first.path);
    await git(path, 'branch', '-D', 'fix/value');
    writeFiles(first.path, { 'partial.txt': '' });
    const again = await createWorktree(repo, worktrees, 'task-abcdef', 'fix/value', null);
    expect(again).toEqual(first);
    expect(existsSync(join(again.path, 'partial.txt'))).toBe(false);
    expect(existsSync(join(again.path, 'README.md'))).toBe(true);
  });

  test('a branch name taken on origin is not reused', async () => {
    const { repo, path } = await createGitRepo();
    await git(path, 'push', '-q', 'origin', 'main:refs/heads/fix/old');
    await git(path, 'fetch', '-q', 'origin');
    expect(await resolveFreeBranch(repo, 'fix/old')).toBe('fix/old-2');
  });

  test('after fifty taken names the branch gets a timestamp', async () => {
    const { repo, path } = await createGitRepo({ remote: false });
    await git(path, 'branch', 'fix/x');
    for (let attempt = 2; attempt < 50; attempt += 1) await git(path, 'branch', `fix/x-${attempt}`);
    expect(await resolveFreeBranch(repo, 'fix/x')).toMatch(/^fix\/x-\d{13}$/);
  });

  test('new work starts from the freshly fetched default branch', async () => {
    const { repo, path, root } = await createGitRepo();
    expect(await resolveStartPoint(repo, null)).toBe('origin/main');
    expect(await resolveStartPoint(repo, 'feat/base')).toBe('feat/base');
    const other = join(root, 'other');
    await git(root, 'clone', '-q', join(root, 'origin.git'), other);
    writeFiles(other, { 'b.txt': 'b\n' });
    await git(other, 'add', '-A');
    await git(other, 'commit', '-q', '-m', 'feat: b');
    await git(other, 'push', '-q', 'origin', 'main');
    const worktree = await createWorktree(repo, createTempDir(), 'task-aaaaaa', 'feat/fresh', null);
    expect(existsSync(join(worktree.path, 'b.txt'))).toBe(true);
    expect(await resolveStartPoint({ ...repo, path, defaultBranch: 'main' }, null)).toBe('origin/main');
  });

  test('without origin the local default branch is the start point', async () => {
    const { repo } = await createGitRepo({ remote: false });
    expect(await resolveStartPoint(repo, null)).toBe('main');
  });

  test('a default branch that looks like an option is refused before git sees it', async () => {
    const { repo } = await createGitRepo({ remote: false });
    await expect(
      resolveStartPoint({ ...repo, defaultBranch: '--upload-pack=touch /tmp/pwned' }, null)
    ).rejects.toThrow('is not a branch name');
    await expect(createWorktree(repo, createTempDir(), 'task-x', '-b', null)).rejects.toThrow(
      'is not a branch name'
    );
  });

  test('refreshing an untouched worktree resets it onto the default branch', async () => {
    const { repo } = await createGitRepo();
    const worktree = await createWorktree(repo, createTempDir(), 'task-bbbbbb', 'fix/refresh', null);
    writeFiles(worktree.path, { 'stray.txt': 'x', 'README.md': 'changed' });
    await refreshWorktree(repo, worktree.path);
    expect(existsSync(join(worktree.path, 'stray.txt'))).toBe(false);
    expect(await git(worktree.path, 'status', '--porcelain')).toBe('');
  });

  test('dependencies are installed with the lockfile the repository uses', async () => {
    const empty = createTempDir();
    await prepareWorktree(empty);
    const broken = createTempDir();
    writeFiles(broken, { 'package-lock.json': '{}' });
    await prepareWorktree(broken);
    const bun = createTempDir();
    writeFiles(bun, { 'package.json': '{"name":"x","private":true}', 'bun.lock': '' });
    await prepareWorktree(bun);
    expect(existsSync(join(bun, 'package.json'))).toBe(true);
  });
});
