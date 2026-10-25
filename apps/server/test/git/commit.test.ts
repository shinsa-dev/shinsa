import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { commitWorktree, pushBranch, resolveHead, stashEdits } from '../../src/git/index.ts';
import { runCommand } from '../../src/shell/index.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

describe('commits and pushes', () => {
  test('a commit takes every change, and a clean tree commits nothing', async () => {
    const { path } = await createGitRepo({ remote: false });
    expect(await commitWorktree(path, 'nothing')).toBeNull();
    writeFiles(path, { 'a.txt': 'a' });
    expect(await commitWorktree(path, 'feat: a\n\nbody')).toEqual({ merge: null });
    expect(await git(path, 'log', '-1', '--format=%B')).toBe('feat: a\n\nbody');
    expect(await resolveHead(path)).toBe(await git(path, 'rev-parse', 'HEAD'));
  });

  test('a merge the agent left uncommitted is committed with both parents and git’s own message, even when it changes no file', async () => {
    const { path } = await createGitRepo({ remote: false, files: { 'a.txt': 'a\n' } });
    const start = await git(path, 'rev-parse', 'HEAD');
    await git(path, 'checkout', '-q', '-b', 'feat');
    writeFiles(path, { 'a.txt': 'feat\n' });
    await git(path, 'commit', '-qam', 'feat');
    await git(path, 'checkout', '-q', 'main');
    writeFiles(path, { 'a.txt': 'main\n' });
    await git(path, 'commit', '-qam', 'main');
    const main = await git(path, 'rev-parse', 'HEAD');
    await git(path, 'checkout', '-q', 'feat');
    await runCommand(['git', 'merge', '--no-edit', 'main'], path);

    await expect(commitWorktree(path, 'fix: merge')).rejects.toThrow(
      'The merge still has conflicts in a.txt. Resolve them and `git add` the files, then hand over again.'
    );
    writeFiles(path, { 'a.txt': 'feat\n' });
    await git(path, 'add', 'a.txt');
    expect(await git(path, 'status', '--porcelain')).toBe('');
    expect(await commitWorktree(path, 'fix: resolve conflicts')).toEqual({
      merge: { mergeHead: `${main}\n`, mergeMessage: "Merge branch 'main' into feat" },
    });
    expect(await git(path, 'log', '-1', '--format=%B')).toBe("Merge branch 'main' into feat");
    expect(await git(path, 'log', '-1', '--format=%P')).toBe(
      `${await git(path, 'rev-parse', 'HEAD^1')} ${main}`
    );
    expect(await git(path, 'merge-base', '--is-ancestor', start, 'HEAD')).toBe('');
  });

  test('a merge of the fetched base reads as a merge of the branch, and one with no message of git’s takes Shinsa’s', async () => {
    const { path } = await createGitRepo({ files: { 'a.txt': 'a\n' } });
    await git(path, 'checkout', '-q', '-b', 'fix/a');
    writeFiles(path, { 'b.txt': 'b\n' });
    await git(path, 'add', '-A');
    await git(path, 'commit', '-qm', 'fix: b');
    await git(path, 'checkout', '-q', 'main');
    writeFiles(path, { 'a.txt': 'main\n' });
    await git(path, 'commit', '-qam', 'main');
    await git(path, 'push', '-q', 'origin', 'main');
    await git(path, 'checkout', '-q', 'fix/a');
    await git(path, 'merge', '--no-commit', '--no-ff', 'origin/main');
    await commitWorktree(path, 'fix: merge the base');
    expect(await git(path, 'log', '-1', '--format=%s')).toBe("Merge branch 'main' into fix/a");

    await git(path, 'reset', '-q', '--hard', 'HEAD^1');
    await git(path, 'merge', '--no-commit', '--no-ff', 'main');
    await git(path, 'rev-parse', '--git-path', 'MERGE_MSG').then((file) => rmSync(join(path, file)));
    await commitWorktree(path, 'fix: merge the base');
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: merge the base');
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
