import { describe, expect, test } from 'bun:test';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorktree, resolveTaskDiff } from '../../src/git/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

describe('resolveTaskDiff', () => {
  test('shows new files without touching the index an agent may be using', async () => {
    const { repo } = await createGitRepo();
    const worktree = await createWorktree(repo, createTempDir(), 'task-cccccc', 'fix/diff', null);
    writeFiles(worktree.path, { 'new.ts': 'export {};\n', 'README.md': '# changed\n' });
    const diff = await resolveTaskDiff(repo, worktree.path, null);
    expect(diff.files.map((file) => file.path).sort()).toEqual(['README.md', 'new.ts']);
    expect(await git(worktree.path, 'status', '--porcelain')).toBe('M README.md\n?? new.ts');
  });

  test('an edit that keeps the size, in the same second the index was written, still shows', async () => {
    const { repo } = await createGitRepo({ remote: false, files: { 'app.ts': 'export const value = 1;\n' } });
    const worktree = await createWorktree(repo, createTempDir(), 'task-ffffff', 'fix/racy', null);
    await git(worktree.path, 'config', 'core.trustctime', 'false');
    const file = join(worktree.path, 'app.ts');
    const index = await git(worktree.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const second = new Date(1_700_000_000_000);
    utimesSync(file, second, second);
    await git(worktree.path, 'update-index', '--refresh');
    utimesSync(index, second, second);
    writeFileSync(file, 'export const value = 2;\n');
    utimesSync(file, second, second);
    const diff = await resolveTaskDiff(repo, worktree.path, null);
    expect(diff.files.map((entry) => entry.path)).toEqual(['app.ts']);
  });

  test('a stacked task diffs against its base branch, and a repo without origin against its default', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const base = await createWorktree(repo, createTempDir(), 'task-dddddd', 'feat/base', null);
    writeFiles(base.path, { 'base.ts': '' });
    await git(base.path, 'add', '-A');
    await git(base.path, 'commit', '-q', '-m', 'feat: base');
    const top = await createWorktree(repo, createTempDir(), 'task-eeeeee', 'feat/top', 'feat/base');
    writeFiles(top.path, { 'top.ts': 'x\n' });
    expect((await resolveTaskDiff(repo, top.path, 'feat/base')).files.map((file) => file.path)).toEqual([
      'top.ts',
    ]);
    expect((await resolveTaskDiff(repo, top.path, null)).files.map((file) => file.path).sort()).toEqual([
      'base.ts',
      'top.ts',
    ]);
  });
});
