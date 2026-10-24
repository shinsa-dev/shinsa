import { describe, expect, test } from 'bun:test';
import { createWorktree, removeWorktree } from '../../src/git/index.ts';
import { resolveTaskRefs } from '../../src/git/task-refs.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

async function commitAll(path: string, message: string) {
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', message);
  return git(path, 'rev-parse', 'HEAD');
}

describe('resolveTaskRefs', () => {
  test('a task with a worktree reads its head there, with the commits since its base and its edits', async () => {
    const { repo } = await createGitRepo();
    const base = await git(repo.path, 'rev-parse', 'HEAD');
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs01', 'feat/refs', null);
    writeFiles(worktree.path, { 'a.ts': '1\n' });
    const first = await commitAll(worktree.path, 'feat: phase one');
    writeFiles(worktree.path, { 'b.ts': '2\n' });
    const second = await commitAll(worktree.path, 'feat: phase two');
    const task = createTask({ branch: 'feat/refs', worktreePath: worktree.path });
    const refs = await resolveTaskRefs(repo, task, null);
    expect(refs).toMatchObject({
      head: second,
      base,
      branch: 'feat/refs',
      defaultBranch: 'main',
      working: true,
      dirty: false,
    });
    expect(refs.commits.map((commit) => [commit.sha, commit.subject])).toEqual([
      [first, 'feat: phase one'],
      [second, 'feat: phase two'],
    ]);
    expect(refs.commits[0]?.at).toBeGreaterThan(0);
    writeFiles(worktree.path, { 'c.ts': '3\n' });
    expect((await resolveTaskRefs(repo, task, null)).dirty).toBe(true);
  });

  test('once the worktree is gone and the branch merged, the head and base stay pinned to the branch', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const base = await git(repo.path, 'rev-parse', 'HEAD');
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs02', 'feat/merged', null);
    writeFiles(worktree.path, { 'a.ts': '1\n' });
    const head = await commitAll(worktree.path, 'feat: merged work');
    await removeWorktree(repo, worktree.path);
    writeFiles(repo.path, { 'main.ts': 'on main\n' });
    await commitAll(repo.path, 'chore: main moves on');
    await git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge feat/merged', 'feat/merged');
    const task = createTask({ branch: 'feat/merged', worktreePath: worktree.path });
    expect(await resolveTaskRefs(repo, task, null)).toMatchObject({
      head,
      base,
      working: false,
      dirty: false,
    });
  });

  test('a branch that was deleted falls back to the pull request head', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs03', 'feat/gone', null);
    writeFiles(worktree.path, { 'a.ts': '1\n' });
    const head = await commitAll(worktree.path, 'feat: gone');
    await removeWorktree(repo, worktree.path);
    await git(repo.path, 'branch', '-D', 'feat/gone');
    const task = createTask({
      branch: 'feat/gone',
      worktreePath: null,
      pullRequest: {
        number: 4,
        url: '',
        state: 'merged',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: true,
        headSha: head,
        updatedAt: 1,
      },
    });
    expect((await resolveTaskRefs(repo, task, null)).head).toBe(head);
  });

  test('a stacked task diffs against the branch under it', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const lower = await createWorktree(repo, createTempDir(), 'task-refs04', 'feat/lower', null);
    writeFiles(lower.path, { 'lower.ts': '1\n' });
    const lowerHead = await commitAll(lower.path, 'feat: lower');
    const upper = await createWorktree(repo, createTempDir(), 'task-refs05', 'feat/upper', 'feat/lower');
    writeFiles(upper.path, { 'upper.ts': '1\n' });
    await commitAll(upper.path, 'feat: upper');
    const task = createTask({ branch: 'feat/upper', worktreePath: upper.path });
    const refs = await resolveTaskRefs(repo, task, 'feat/lower');
    expect(refs.base).toBe(lowerHead);
    expect(refs.commits.map((commit) => commit.subject)).toEqual(['feat: upper']);
  });

  test('a task without a branch reads the default branch, origin first', async () => {
    const { repo, path } = await createGitRepo();
    writeFiles(path, { 'local.ts': 'not pushed\n' });
    await commitAll(path, 'chore: local only');
    const origin = await git(path, 'rev-parse', 'origin/main');
    const refs = await resolveTaskRefs(repo, createTask({ branch: null, worktreePath: null }), null);
    expect(refs).toMatchObject({ head: origin, base: null, branch: null, working: false, commits: [] });
  });

  test('a task whose code is nowhere is a refusal', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const task = createTask({ branch: 'feat/never', worktreePath: '/nowhere/at/all' });
    await expect(resolveTaskRefs(repo, task, null)).rejects.toMatchObject({ code: 'code_unavailable' });
  });

  test('a base branch that is gone leaves the task without a base', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs06', 'feat/orphan', null);
    await git(repo.path, 'branch', '-m', 'main', 'trunk');
    const task = createTask({ branch: 'feat/orphan', worktreePath: worktree.path });
    expect(await resolveTaskRefs(repo, task, null)).toMatchObject({ base: null, commits: [] });
  });
});
