import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkBundleMerge } from '../../src/git/index.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

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
  { taskId: 'root', branch: 'feat/root', base: 'main' },
  { taskId: 'middle', branch: 'feat/middle', base: 'feat/root' },
  { taskId: 'top', branch: 'feat/top', base: 'feat/middle' },
];

describe('checkBundleMerge', () => {
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
      checkBundleMerge(repo, [...BRANCHES, { taskId: 'gone', branch: 'feat/gone', base: 'feat/top' }])
    ).rejects.toThrow();
  });
});
