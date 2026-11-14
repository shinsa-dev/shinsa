import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { runCommand } from '../helpers/shell.ts';
import { createRound, createTask } from '../helpers/state.ts';
import { openStrategy } from './harness.ts';

setDefaultTimeout(30_000);

async function startTask() {
  const made = await createGitRepo();
  const strategy = openStrategy(createTempDir());
  const checkout = await strategy.prepare(made.repo, createTask({ worktreePath: null }));
  const task = createTask({ worktreePath: checkout.path, branch: checkout.branch });
  return { ...made, strategy, checkout, task };
}

async function pushToOrigin(root: string, origin: string, files: Record<string, string>) {
  const clone = join(createTempDir(), 'clone');
  await git(root, 'clone', '-q', origin, clone);
  writeFiles(clone, files);
  await git(clone, 'add', '-A');
  await git(clone, 'commit', '-qm', 'main moved');
  await git(clone, 'push', '-q', 'origin', 'main');
  return git(clone, 'rev-parse', 'HEAD');
}

describe('worktrees', () => {
  test('a task gets a worktree of its own on a fresh branch, and commits and pushes from it', async () => {
    const { repo, origin, strategy, checkout, task } = await startTask();
    expect(checkout.branch).toBe('fix/tab-scroll');
    writeFiles(checkout.path, { 'a.txt': 'a\n', 'docs/ä b.md': 'b\n' });
    const commit = await strategy.commit(repo, task, 'feat: a');
    expect(commit.treeHash).toBe(await git(checkout.path, 'rev-parse', 'HEAD^{tree}'));
    expect(commit.files).toEqual(['a.txt', 'docs/ä b.md']);
    const sha = await strategy.push(repo, task);
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(sha);
    await commit.undo();
    expect(await git(checkout.path, 'status', '--porcelain')).toContain('A  a.txt');
    await git(checkout.path, 'reset', '-q', '--hard');
    const head = await git(checkout.path, 'rev-parse', 'HEAD');
    const nothing = await strategy.commit(repo, task, 'feat: nothing');
    expect(nothing.files).toEqual([]);
    await nothing.undo();
    expect(await git(checkout.path, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('a resolved merge of the base is committed as git’s merge, and undo puts it back in progress', async () => {
    const { repo, path, strategy, checkout, task } = await startTask();
    writeFiles(checkout.path, { 'a.txt': 'task\n' });
    await strategy.commit(repo, task, 'feat: a');
    writeFiles(path, { 'a.txt': 'main\n' });
    await git(path, 'add', 'a.txt');
    await git(path, 'commit', '-qm', 'main moved');
    await runCommand(['git', 'merge', '--no-edit', 'main'], checkout.path);
    writeFiles(checkout.path, { 'a.txt': 'task\nmain\n' });
    await git(checkout.path, 'add', 'a.txt');

    const commit = await strategy.commit(repo, task, 'fix: resolve conflicts');
    const main = await git(path, 'rev-parse', 'main');
    expect(await git(checkout.path, 'rev-parse', 'HEAD^2')).toBe(main);
    await commit.undo();
    expect(await git(checkout.path, 'rev-parse', 'MERGE_HEAD')).toBe(main);
    await strategy.commit(repo, task, 'fix: resolve conflicts again');
    expect(await git(checkout.path, 'log', '-1', '--format=%s %P')).toBe(
      `Merge branch 'main' into fix/tab-scroll ${await git(checkout.path, 'rev-parse', 'HEAD^1')} ${main}`
    );
  });

  test('an untouched worktree is reset, a later round only drops its scratch edits, and work is kept', async () => {
    const { repo, strategy, checkout, task } = await startTask();
    writeFiles(checkout.path, { 'stray.txt': 'x' });
    await strategy.prepare(repo, task);
    expect(existsSync(join(checkout.path, 'stray.txt'))).toBe(false);
    writeFiles(checkout.path, { 'scratch.txt': 'x' });
    const later = { ...task, rounds: [createRound(), createRound({ number: 2, status: 'active' })] };
    await strategy.prepare(repo, later);
    expect(existsSync(join(checkout.path, 'scratch.txt'))).toBe(false);
    writeFiles(checkout.path, { 'kept.txt': 'x' });
    await strategy.prepare(repo, { ...task, phaseReports: [{}] as typeof task.phaseReports });
    expect(existsSync(join(checkout.path, 'kept.txt'))).toBe(true);
  });

  test('a later round takes in the latest base, and a base that conflicts is left for the push', async () => {
    const { root, origin, repo, strategy, checkout, task } = await startTask();
    writeFiles(checkout.path, { 'a.txt': 'task\n' });
    await strategy.commit(repo, task, 'feat: a');
    const later = { ...task, rounds: [createRound(), createRound({ number: 2, status: 'active' })] };
    const moved = await pushToOrigin(root, origin, { 'b.txt': 'main\n' });
    await strategy.prepare(repo, later);
    expect(existsSync(join(checkout.path, 'b.txt'))).toBe(true);
    expect(await git(checkout.path, 'rev-parse', 'HEAD^2')).toBe(moved);
    const head = await git(checkout.path, 'rev-parse', 'HEAD');
    await pushToOrigin(root, origin, { 'a.txt': 'main\n' });
    await strategy.prepare(repo, later);
    expect(await git(checkout.path, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(checkout.path, 'status', '--porcelain')).toBe('');
    await git(repo.path, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
    await strategy.prepare(repo, later);
    expect(await git(checkout.path, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('a fetch moves local main forward only when nothing has it checked out and it has no commits of its own', async () => {
    const { root, origin, path, repo, strategy } = await startTask();
    const kept = await git(path, 'rev-parse', 'main');
    await pushToOrigin(root, origin, { 'b.txt': 'one\n' });
    await strategy.prepare(repo, createTask({ id: 'two', branch: 'feat/two', worktreePath: null }));
    expect(await git(path, 'rev-parse', 'main')).toBe(kept);

    await git(path, 'checkout', '-q', '-b', 'elsewhere');
    const moved = await pushToOrigin(root, origin, { 'c.txt': 'two\n' });
    const three = await strategy.prepare(
      repo,
      createTask({ id: 'three', branch: 'feat/three', worktreePath: null })
    );
    expect(await git(path, 'rev-parse', 'main')).toBe(moved);
    expect(await git(three.path, 'rev-parse', 'HEAD')).toBe(moved);

    await git(path, 'checkout', '-q', 'main');
    writeFiles(path, { 'own.txt': 'mine\n' });
    await git(path, 'add', '-A');
    await git(path, 'commit', '-qm', 'local only');
    const own = await git(path, 'rev-parse', 'main');
    await git(path, 'checkout', '-q', 'elsewhere');
    await pushToOrigin(root, origin, { 'd.txt': 'three\n' });
    await strategy.prepare(repo, createTask({ id: 'four', branch: 'feat/four', worktreePath: null }));
    expect(await git(path, 'rev-parse', 'main')).toBe(own);

    const known = await git(path, 'rev-parse', 'origin/main');
    await git(path, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
    const offline = await strategy.prepare(
      repo,
      createTask({ id: 'five', branch: 'feat/five', worktreePath: null })
    );
    expect(await git(offline.path, 'rev-parse', 'HEAD')).toBe(known);
  });

  test('an untouched worktree of a task stacked later is reset onto the branch below', async () => {
    const { repo, strategy, checkout, task } = await startTask();
    const below = await strategy.prepare(
      repo,
      createTask({ id: 'below', branch: 'feat/below', worktreePath: null })
    );
    writeFiles(below.path, { 'below.txt': 'below\n' });
    await strategy.commit(
      repo,
      createTask({ id: 'below', branch: below.branch, worktreePath: below.path }),
      'feat: below'
    );
    await strategy.prepare(repo, { ...task, stackBases: [below.branch] });
    expect(existsSync(join(checkout.path, 'below.txt'))).toBe(true);
  });

  test('a task stacked on several starts from the first and merges the others in, skipping one that conflicts', async () => {
    const made = await createGitRepo();
    const strategy = openStrategy(createTempDir());
    const parents: string[] = [];
    for (const [id, files] of [
      ['b', { 'b.txt': 'b\n', 'shared.txt': 'b\n' }],
      ['c', { 'c.txt': 'c\n' }],
      ['d', { 'shared.txt': 'd\n' }],
    ] as const) {
      const parent = await strategy.prepare(
        made.repo,
        createTask({ id, branch: `feat/${id}`, worktreePath: null })
      );
      writeFiles(parent.path, files);
      await strategy.commit(
        made.repo,
        createTask({ id, branch: parent.branch, worktreePath: parent.path }),
        `feat: ${id}`
      );
      parents.push(parent.branch);
    }
    const stacked = createTask({ id: 'f', branch: 'feat/f', worktreePath: null, stackBases: parents });
    const checkout = await strategy.prepare(made.repo, stacked);
    expect(existsSync(join(checkout.path, 'b.txt'))).toBe(true);
    expect(existsSync(join(checkout.path, 'c.txt'))).toBe(true);
    expect(await git(checkout.path, 'show', 'HEAD:shared.txt')).toBe('b');
    expect(await git(checkout.path, 'log', '-1', '--format=%s')).toBe("Merge branch 'feat/c' into feat/f");
    expect(await git(checkout.path, 'status', '--porcelain')).toBe('');
    writeFiles(checkout.path, { 'stray.txt': 'x' });
    await strategy.prepare(made.repo, { ...stacked, worktreePath: checkout.path });
    expect(existsSync(join(checkout.path, 'stray.txt'))).toBe(false);
    expect(existsSync(join(checkout.path, 'c.txt'))).toBe(true);
  });

  test('a finished task’s worktree is removed; a task without a branch cannot have one', async () => {
    const { repo, strategy, checkout, task } = await startTask();
    await strategy.remove(repo, task);
    expect(existsSync(checkout.path)).toBe(false);
    await strategy.remove(repo, { ...task, worktreePath: null });
    await expect(strategy.prepare(repo, createTask({ branch: null, worktreePath: null }))).rejects.toThrow(
      'The task has no branch yet.'
    );
    await expect(strategy.push(repo, { ...task, worktreePath: null })).rejects.toThrow(
      'The task has no worktree.'
    );
  });

  test('the base is brought into the task’s worktree, and a task without one is refused', async () => {
    const { repo, strategy, task } = await startTask();
    const onBehind = () => Promise.resolve();
    expect(await strategy.syncBase(repo, task, 'main', { onBehind })).toEqual({ status: 'current' });
    await expect(
      strategy.syncBase(repo, createTask({ worktreePath: null }), 'main', { onBehind })
    ).rejects.toThrow('The task has no worktree.');
  });
});

describe('the folder new worktrees go in', () => {
  test('a new task gets its worktree in the folder chosen now, and one already made stays where it is', async () => {
    const made = await createGitRepo();
    const strategy = openStrategy(createTempDir());
    const first = await strategy.mark(createTempDir());
    await strategy.choose(first);
    const before = await strategy.prepare(made.repo, createTask({ id: 'task-before1', worktreePath: null }));
    expect(before.path.startsWith(first)).toBe(true);
    const second = await strategy.mark(createTempDir());
    await strategy.choose(second);
    const after = await strategy.prepare(made.repo, createTask({ id: 'task-after01', worktreePath: null }));
    expect(after.path.startsWith(second)).toBe(true);
    const kept = createTask({ id: 'task-before1', worktreePath: before.path, branch: before.branch });
    expect((await strategy.prepare(made.repo, kept)).path).toBe(before.path);
  });

  test('a task whose checkout is the repository itself never has the repository removed', async () => {
    const { repo, path, strategy } = await startTask();
    await strategy.remove(repo, createTask({ worktreePath: path, branch: 'main' }));
    await strategy.remove(repo, createTask({ worktreePath: `${path}/`, branch: 'main' }));
    expect(existsSync(join(path, '.git'))).toBe(true);
    expect(await git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  test('a chosen folder that is not mounted stops the task, and nothing is made on the local disk', async () => {
    const made = await createGitRepo();
    const missing = join(createTempDir(), 'bucket', 'worktrees');
    const strategy = openStrategy(createTempDir());
    await strategy.choose(missing);
    await expect(strategy.prepare(made.repo, createTask({ worktreePath: null }))).rejects.toThrow(
      `The worktree folder ${missing} does not exist.`
    );
    expect(existsSync(missing)).toBe(false);
  });

  test('a chosen drive that is unmounted leaves an empty folder, which is refused and left empty', async () => {
    const made = await createGitRepo();
    const mountPoint = createTempDir();
    const strategy = openStrategy(createTempDir());
    await strategy.choose(mountPoint);
    await expect(strategy.prepare(made.repo, createTask({ worktreePath: null }))).rejects.toThrow(
      `The worktree folder ${mountPoint} is not the one you chose: the drive it is on may not be mounted.`
    );
    expect(readdirSync(mountPoint)).toEqual([]);
  });
});
