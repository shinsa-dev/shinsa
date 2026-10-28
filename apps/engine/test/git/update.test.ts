import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { commitWorktree, PushError, updateOntoBase } from '../../src/git/index.ts';
import { runCommand } from '../../src/shell/index.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

async function moveMain(origin: string, root: string, files: Record<string, string>) {
  const other = join(root, `other-${Object.keys(files).join('-').replace(/\W/g, '')}`);
  await git(root, 'clone', '-q', origin, other);
  writeFiles(other, files);
  await git(other, 'add', '-A');
  await git(other, 'commit', '-q', '-m', 'feat: move main');
  await git(other, 'push', '-q', 'origin', 'main');
}

async function startBranch(path: string, files: Record<string, string>) {
  await git(path, 'checkout', '-q', '-b', 'feat/a');
  writeFiles(path, files);
  await commitWorktree(path, 'feat: a');
}

async function isMerging(path: string) {
  return (await runCommand(['git', 'rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], path)).ok;
}

function track() {
  const behind: string[] = [];
  return {
    behind,
    options: {
      onBehind: () => {
        behind.push('updating');
        return Promise.resolve();
      },
    },
  };
}

describe('updateOntoBase', () => {
  test('a branch that already has its base is left alone', async () => {
    const { path } = await createGitRepo();
    await startBranch(path, { 'a.txt': 'a' });
    const before = await git(path, 'rev-parse', 'HEAD');
    const { behind, options } = track();
    expect(await updateOntoBase(path, 'main', 'feat/a', options)).toEqual({ status: 'current' });
    expect(behind).toEqual([]);
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(before);
  });

  test('a branch behind its base gets the base merged in, so it carries the base’s hook and fixes', async () => {
    const { path, origin, root } = await createGitRepo();
    await startBranch(path, { 'a.txt': 'a' });
    await moveMain(origin, root, { '.husky/pre-push': 'bun run check-types\n' });
    const { behind, options } = track();
    expect(await updateOntoBase(path, 'main', 'feat/a', options)).toEqual({ status: 'merged' });
    expect(behind).toEqual(['updating']);
    expect(await git(path, 'log', '-1', '--format=%s')).toBe("Merge branch 'main' into feat/a");
    expect(await git(path, 'show', 'HEAD:.husky/pre-push')).toBe('bun run check-types');
    expect((await git(path, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ')).toHaveLength(3);
    expect(await git(path, 'status', '--porcelain')).toBe('');
  });

  test('conflicts are listed and the merge is stopped, so the checkout is never left mid-merge', async () => {
    const { path, origin, root } = await createGitRepo();
    await startBranch(path, { 'README.md': 'mine\n', 'b.txt': 'mine\n' });
    await moveMain(origin, root, { 'README.md': 'theirs\n', 'b.txt': 'theirs\n' });
    const before = await git(path, 'rev-parse', 'HEAD');
    const { options } = track();
    expect(await updateOntoBase(path, 'main', 'feat/a', options)).toEqual({
      status: 'conflicted',
      files: ['README.md', 'b.txt'],
    });
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(before);
    expect(await git(path, 'status', '--porcelain')).toBe('');
    expect(await isMerging(path)).toBe(false);
  });

  test('a merge git refuses for another reason is stopped and reported', async () => {
    const { path, origin, root } = await createGitRepo();
    await startBranch(path, { 'a.txt': 'a' });
    await moveMain(origin, root, { 'c.txt': 'theirs\n' });
    writeFiles(path, { 'c.txt': 'untracked\n' });
    const { options } = track();
    await expect(updateOntoBase(path, 'main', 'feat/a', options)).rejects.toThrow('git merge --quiet failed');
    expect(await isMerging(path)).toBe(false);
  });

  test('a base the remote does not have is skipped; a remote it cannot reach is the network', async () => {
    const { path } = await createGitRepo();
    const { options } = track();
    expect(await updateOntoBase(path, 'feat/gone', 'feat/a', options)).toEqual({ status: 'current' });
    await git(path, 'remote', 'set-url', 'origin', 'https://127.0.0.1:1/acme/app.git');
    const error = await updateOntoBase(path, 'main', 'feat/a', options).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PushError);
    expect(error).toMatchObject({ kind: 'network' });
  });

  test('a ref git cannot compare is an error, not an update', async () => {
    const { path } = await createGitRepo({ remote: false });
    await git(path, 'remote', 'add', 'origin', path);
    await git(path, 'checkout', '-q', '--orphan', 'empty');
    const { options } = track();
    await expect(updateOntoBase(path, 'main', 'empty', options)).rejects.toThrow('git merge-base');
  });
});
