import { describe, expect, test } from 'bun:test';
import { commitWorktree, pushBranch, resolveHead, stashEdits } from '../../src/git/index.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

describe('commits and pushes', () => {
  test('a commit takes every change, and a clean tree commits nothing', async () => {
    const { path } = await createGitRepo({ remote: false });
    expect(await commitWorktree(path, 'nothing')).toBe(false);
    writeFiles(path, { 'a.txt': 'a' });
    expect(await commitWorktree(path, 'feat: a\n\nbody')).toBe(true);
    expect(await git(path, 'log', '-1', '--format=%B')).toBe('feat: a\n\nbody');
    expect(await resolveHead(path)).toBe(await git(path, 'rev-parse', 'HEAD'));
  });

  test('edits are set aside in a stash, and a clean tree stashes nothing', async () => {
    const { path } = await createGitRepo({ remote: false });
    expect(await stashEdits(path, 'shinsa: edits')).toBe(false);
    writeFiles(path, { 'new.txt': 'n', 'README.md': 'x' });
    expect(await stashEdits(path, 'shinsa: edits')).toBe(true);
    expect(await git(path, 'status', '--porcelain')).toBe('');
    expect(await git(path, 'stash', 'list')).toContain('shinsa: edits');
  });

  test('pushing sends HEAD to the named branch on origin', async () => {
    const { path, origin } = await createGitRepo();
    writeFiles(path, { 'a.txt': 'a' });
    await commitWorktree(path, 'feat: a');
    await pushBranch(path, 'feat/a');
    expect(await git(origin, 'rev-parse', 'refs/heads/feat/a')).toBe(await resolveHead(path));
    await expect(pushBranch(path, '--force')).rejects.toThrow('is not a branch name');
  });
});
