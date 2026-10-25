import { describe, expect, test } from 'bun:test';
import { listChangedFiles } from '../../src/git/changed-files.ts';
import { createWorktree } from '../../src/git/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

async function commitAll(path: string, message: string) {
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', message);
}

describe('the files a task changed', () => {
  test('a task with a worktree lists what its branch committed and what it has not committed yet', async () => {
    const { repo } = await createGitRepo();
    const worktree = await createWorktree(repo, createTempDir(), 'files01', 'feat/files', null);
    writeFiles(worktree.path, { 'src/a.ts': '1\n' });
    await commitAll(worktree.path, 'feat: a');
    writeFiles(worktree.path, { 'README.md': '# changed\n', 'new/c.ts': '3\n', 'src/a.ts': '2\n' });
    const task = createTask({ branch: 'feat/files', worktreePath: worktree.path });
    expect(await listChangedFiles(repo, task, null)).toEqual(['README.md', 'new/c.ts', 'src/a.ts']);
  });

  test('a GitButler branch lists its commits from the repository, and a branch not made yet lists none', async () => {
    const { repo } = await createGitRepo({ remote: false });
    await git(repo.path, 'checkout', '-q', '-b', 'feat/butler');
    writeFiles(repo.path, { 'b.ts': '1\n' });
    await commitAll(repo.path, 'feat: b');
    await git(repo.path, 'checkout', '-q', 'main');
    writeFiles(repo.path, { 'mine.ts': 'not the task’s\n' });
    const butler = createTask({ branch: 'feat/butler', worktreePath: repo.path, workspace: 'gitbutler' });
    expect(await listChangedFiles(repo, butler, null)).toEqual(['b.ts']);
    const unborn = createTask({ branch: 'feat/later', worktreePath: null });
    expect(await listChangedFiles(repo, unborn, null)).toEqual([]);
  });

  test('a branch stacked on another lists only its own files', async () => {
    const { repo } = await createGitRepo({ remote: false });
    await git(repo.path, 'checkout', '-q', '-b', 'feat/below');
    writeFiles(repo.path, { 'below.ts': '1\n' });
    await commitAll(repo.path, 'feat: below');
    await git(repo.path, 'checkout', '-q', '-b', 'feat/above');
    writeFiles(repo.path, { 'above.ts': '1\n' });
    await commitAll(repo.path, 'feat: above');
    await git(repo.path, 'checkout', '-q', 'main');
    const above = createTask({ branch: 'feat/above', worktreePath: null });
    expect(await listChangedFiles(repo, above, 'feat/below')).toEqual(['above.ts']);
    expect(await listChangedFiles(repo, above, null)).toEqual(['above.ts', 'below.ts']);
  });

  test('a checkout git cannot read fails rather than answering with nothing', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const task = createTask({ branch: 'feat/gone', worktreePath: createTempDir() });
    await expect(listChangedFiles(repo, task, null)).rejects.toThrow();
  });
});
