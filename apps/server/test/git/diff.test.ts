import { describe, expect, test } from 'bun:test';
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
