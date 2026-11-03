import { describe, expect, test } from 'bun:test';
import { createWorktree, removeWorktree } from '../../src/git/index.ts';
import { resolveTaskRefs } from '../../src/git/task-refs.ts';
import { runCommand } from '../../src/shell/index.ts';
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

  test('a task stacked on several compares against all of them merged, so only its own work shows', async () => {
    const { repo } = await createGitRepo();
    for (const branch of ['feat/b', 'feat/c']) {
      await git(repo.path, 'checkout', '-q', '-b', branch, 'main');
      writeFiles(repo.path, { [`${branch.slice(5)}.ts`]: `${branch}\n` });
      await commitAll(repo.path, `feat: ${branch}`);
    }
    await git(repo.path, 'checkout', '-q', 'main');
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs05', 'feat/f', 'feat/b');
    await git(worktree.path, 'merge', '-q', '--no-edit', 'feat/c');
    writeFiles(worktree.path, { 'f.ts': 'f\n' });
    const own = await commitAll(worktree.path, 'feat: f');
    const task = createTask({
      branch: 'feat/f',
      worktreePath: worktree.path,
      stackBases: ['feat/b', 'feat/c'],
    });
    const refs = await resolveTaskRefs(repo, task, 'feat/b');
    expect(await git(repo.path, 'diff', '--name-only', refs.base ?? '', refs.head)).toBe('f.ts');
    expect(refs.commits.map((commit) => commit.sha)).toContain(own);
    expect(refs.commits.map((commit) => commit.subject)).not.toContain('feat: feat/c');
    expect((await resolveTaskRefs(repo, task, 'feat/b')).base).toBe(refs.base);
    const single = await resolveTaskRefs(repo, { ...task, stackBases: ['feat/b'] }, 'feat/b');
    expect(await git(repo.path, 'diff', '--name-only', single.base ?? '', single.head)).toBe('c.ts\nf.ts');
  });

  test('parents that contain each other or conflict fall back to the newest one or the first one', async () => {
    const { repo } = await createGitRepo();
    await git(repo.path, 'checkout', '-q', '-b', 'feat/b', 'main');
    writeFiles(repo.path, { 'shared.ts': 'b\n' });
    await commitAll(repo.path, 'feat: b');
    await git(repo.path, 'checkout', '-q', '-b', 'feat/c', 'feat/b');
    writeFiles(repo.path, { 'c.ts': 'c\n' });
    const c = await commitAll(repo.path, 'feat: c');
    await git(repo.path, 'checkout', '-q', '-b', 'feat/d', 'main');
    writeFiles(repo.path, { 'shared.ts': 'd\n' });
    await commitAll(repo.path, 'feat: d');
    await git(repo.path, 'checkout', '-q', 'main');
    const worktree = await createWorktree(repo, createTempDir(), 'task-refs06', 'feat/g', 'feat/c');
    writeFiles(worktree.path, { 'g.ts': 'g\n' });
    await commitAll(worktree.path, 'feat: g');
    const task = createTask({
      branch: 'feat/g',
      worktreePath: worktree.path,
      stackBases: ['feat/b', 'feat/c'],
    });
    expect((await resolveTaskRefs(repo, task, 'feat/b')).base).toBe(c);
    expect((await resolveTaskRefs(repo, { ...task, stackBases: ['feat/c', 'feat/b'] }, 'feat/c')).base).toBe(
      c
    );
    await runCommand(['git', 'merge', '-q', '--no-edit', 'feat/d'], worktree.path);
    writeFiles(worktree.path, { 'shared.ts': 'b and d\n' });
    await commitAll(worktree.path, 'fix: resolve conflicts');
    const conflicting = { ...task, stackBases: ['feat/c', 'feat/d'] };
    expect((await resolveTaskRefs(repo, conflicting, 'feat/c')).base).toBe(c);
    const missing = { ...task, stackBases: ['feat/c', 'feat/gone'] };
    expect((await resolveTaskRefs(repo, missing, 'feat/c')).base).toBe(c);
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
