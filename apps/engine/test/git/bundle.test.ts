import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { join } from 'node:path';
import type { Repo } from '@shinsa/core';
import type { BundleBranch } from '../../src/git/remote/schema.ts';
import { Remote } from '../../src/git/remote/service.ts';
import { runGit } from '../helpers/git.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

setDefaultTimeout(30_000);

const checkBundleMerge = (repo: Repo, members: BundleBranch[], signal?: AbortSignal) =>
  runGit(Remote.use((remote) => remote.checkBundleMerge(repo, members, signal)));

async function commitBranch(path: string, branch: string, from: string, files: Record<string, string>) {
  await git(path, 'checkout', '-q', '-B', branch, from);
  writeFiles(path, files);
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', `feat: ${branch}`);
  await git(path, 'push', '-q', '-f', 'origin', branch);
}

async function moveMain(origin: string, root: string, files: Record<string, string>) {
  const other = join(root, 'other');
  await git(root, 'clone', '-q', origin, other);
  writeFiles(other, files);
  await git(other, 'add', '-A');
  await git(other, 'commit', '-q', '-m', 'feat: move main');
  await git(other, 'push', '-q', 'origin', 'main');
}

async function createBundle() {
  const created = await createGitRepo({ files: { 'top.txt': 'start\n' } });
  await commitBranch(created.path, 'feat/root', 'main', { 'root.txt': 'root\n' });
  await commitBranch(created.path, 'feat/middle', 'feat/root', { 'middle.txt': 'middle\n' });
  await commitBranch(created.path, 'feat/top', 'feat/middle', { 'top.txt': 'top\n' });
  return created;
}

const BRANCHES = [
  { taskId: 'root', branch: 'feat/root', bases: ['main'] },
  { taskId: 'middle', branch: 'feat/middle', bases: ['feat/root'] },
  { taskId: 'top', branch: 'feat/top', bases: ['feat/middle'] },
];

async function createDiamond() {
  const created = await createGitRepo({ files: { 'top.txt': 'start\n' } });
  await commitBranch(created.path, 'feat/a', 'main', { 'a.txt': 'a\n' });
  await commitBranch(created.path, 'feat/b', 'feat/a', { 'b.txt': 'b\n' });
  await commitBranch(created.path, 'feat/c', 'feat/a', { 'c.txt': 'c\n' });
  await git(created.path, 'checkout', '-q', '-B', 'feat/f', 'feat/b');
  await git(created.path, 'merge', '-q', '--no-edit', 'feat/c');
  await commitBranch(created.path, 'feat/f', 'feat/f', { 'f.txt': 'f\n' });
  return created;
}

const DIAMOND = [
  { taskId: 'a', branch: 'feat/a', bases: ['main'] },
  { taskId: 'b', branch: 'feat/b', bases: ['feat/a'] },
  { taskId: 'c', branch: 'feat/c', bases: ['feat/a'] },
  { taskId: 'f', branch: 'feat/f', bases: ['feat/b', 'feat/c'] },
];

describe('checkBundleMerge', () => {
  test('a diamond whose fan-in branch has both parents merges cleanly', async () => {
    const { repo } = await createDiamond();
    expect(await checkBundleMerge(repo, DIAMOND)).toBeNull();
  });

  test('a fix pushed to one parent of a fan-in branch is found behind on that parent', async () => {
    const { repo, path } = await createDiamond();
    await commitBranch(path, 'feat/c', 'feat/c', { 'f.txt': 'c\n' });
    expect(await checkBundleMerge(repo, DIAMOND)).toEqual({
      taskId: 'f',
      behindTaskId: 'f',
      base: 'feat/c',
    });
  });

  test('a bundle whose branches merge cleanly into the default branch has no conflict', async () => {
    const { repo, origin, root } = await createBundle();
    expect(await checkBundleMerge(repo, BRANCHES)).toBeNull();
    await moveMain(origin, root, { 'other.txt': 'other\n' });
    expect(await checkBundleMerge(repo, BRANCHES)).toBeNull();
  });

  test('a branch three layers up that conflicts with the default branch is found, with the lowest branch behind', async () => {
    const { repo, origin, root } = await createBundle();
    await moveMain(origin, root, { 'top.txt': 'main\n' });
    expect(await checkBundleMerge(repo, BRANCHES)).toEqual({
      taskId: 'top',
      behindTaskId: 'root',
      base: 'main',
    });
  });

  test('a fix pushed below that the branch above does not have yet is found behind', async () => {
    const { repo, path } = await createBundle();
    await commitBranch(path, 'feat/middle', 'feat/middle', { 'top.txt': 'middle\n' });
    expect(await checkBundleMerge(repo, BRANCHES)).toEqual({
      taskId: 'top',
      behindTaskId: 'top',
      base: 'feat/middle',
    });
  });

  test('a branch missing on the remote fails the check', async () => {
    const { repo } = await createBundle();
    await expect(
      checkBundleMerge(repo, [...BRANCHES, { taskId: 'gone', branch: 'feat/gone', bases: ['feat/top'] }])
    ).rejects.toThrow();
  });

  test('a branch git cannot merge at all fails the check instead of reading as a conflict', async () => {
    const { repo, path } = await createBundle();
    await git(path, 'checkout', '-q', '--orphan', 'feat/unrelated');
    writeFiles(path, { 'alone.txt': 'alone\n' });
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'feat: unrelated');
    await git(path, 'push', '-q', '-f', 'origin', 'feat/unrelated');
    await expect(
      checkBundleMerge(repo, [{ taskId: 'unrelated', branch: 'feat/unrelated', bases: ['main'] }])
    ).rejects.toThrow('merge-tree');
  });
});
