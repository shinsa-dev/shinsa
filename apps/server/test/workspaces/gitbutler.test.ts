import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, Task } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { readButStatus } from '../../src/workspaces/but.ts';
import { GitButlerStrategy } from '../../src/workspaces/gitbutler.ts';
import { WorkspaceLock } from '../../src/workspaces/lock.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { createRound, createTask } from '../helpers/state.ts';

async function createWorkspace(files: Record<string, string> = {}) {
  const made = await createGitRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n', ...files } });
  await runCommandOrThrow(['but', 'setup', '--json'], made.path);
  const strategy = new GitButlerStrategy(createTempDir());
  return { ...made, strategy };
}

async function startTask(strategy: GitButlerStrategy, repo: Repo, id: string, branch: string) {
  const draft = createTask({ id, branch, worktreePath: null, workspace: 'gitbutler' });
  const checkout = await strategy.prepare(repo, draft);
  return createTask({ id, branch: checkout.branch, worktreePath: checkout.path, workspace: 'gitbutler' });
}

async function listApplied(path: string) {
  const status = await readButStatus(path);
  return status.stacks.flatMap((stack) => stack.branches.map((branch) => branch.name)).sort();
}

function listUncommitted(path: string) {
  return git(path, 'status', '--porcelain', '--untracked-files=all');
}

function readBranchFile(path: string, branch: string, file: string) {
  return git(path, 'show', `${branch}:${file}`);
}

async function editAndCommit(
  strategy: GitButlerStrategy,
  repo: Repo,
  task: Task,
  files: Record<string, string>,
  canStackOn?: (branch: string) => boolean
) {
  const release = await strategy.claim(repo, task);
  writeFiles(repo.path, files);
  try {
    return await strategy.commit(repo, task, `feat: ${task.id}`, canStackOn);
  } finally {
    await release();
  }
}

describe('GitButler workspaces', () => {
  test('each task gets its own branch, applied next to the others in the one checkout', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    expect(first).toMatchObject({ worktreePath: path, branch: 'fix/scroll' });
    expect(await listApplied(path)).toEqual(['feat/banner', 'fix/scroll']);

    await editAndCommit(strategy, repo, first, { 'a.txt': 'a, fixed\n' });
    await editAndCommit(strategy, repo, second, { 'banner.txt': 'banner\n' });
    expect(await readBranchFile(path, 'fix/scroll', 'a.txt')).toBe('a, fixed');
    expect(await git(path, 'ls-tree', '--name-only', 'fix/scroll')).not.toContain('banner.txt');
    expect(await readBranchFile(path, 'feat/banner', 'banner.txt')).toBe('banner');
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('a, fixed\n');
    expect(existsSync(join(path, 'banner.txt'))).toBe(true);
    expect(await listUncommitted(path)).toBe('');
  });

  test('your own uncommitted work stays uncommitted and is never put on a task’s branch', async () => {
    const { repo, path, strategy } = await createWorkspace();
    writeFiles(path, { 'notes.txt': 'mine\n', 'b.txt': 'b, mine\n' });
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const commit = await editAndCommit(strategy, repo, task, { 'a.txt': 'a, fixed\n' });
    expect(commit.treeHash).toBe(await git(path, 'rev-parse', 'fix/scroll^{tree}'));
    expect(await git(path, 'show', '--name-only', '--format=', 'fix/scroll')).toBe('a.txt');
    expect(await listUncommitted(path)).toBe('M b.txt\n?? notes.txt');
  });

  test('an agent that edits a file with your uncommitted work in it is refused, and nothing is committed', async () => {
    const { repo, path, strategy } = await createWorkspace();
    writeFiles(path, { 'b.txt': 'b, mine\n' });
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const release = await strategy.claim(repo, task);
    writeFiles(path, { 'b.txt': 'b, mine, and the agent’s\n', 'a.txt': 'a, fixed\n' });
    await expect(strategy.commit(repo, task, 'feat: x')).rejects.toThrow(
      'These files had uncommitted changes that are not this task’s, so Shinsa will not commit them to its branch: b.txt.'
    );
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await release();
    expect(warn).toHaveBeenCalledWith(
      '[Workspaces] An agent changed files with uncommitted work that is not its task’s',
      { taskId: 'task-1', paths: ['b.txt'] }
    );
    warn.mockRestore();
    expect(await git(path, 'rev-parse', 'fix/scroll')).toBe(await git(path, 'rev-parse', 'main'));
  });

  test('a commit with nothing new changes nothing, and undo hands the changes back to the task', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const release = await strategy.claim(repo, task);
    const empty = await strategy.commit(repo, task, 'feat: nothing');
    expect(empty.treeHash).toBe(await git(path, 'rev-parse', 'main^{tree}'));
    await empty.undo();
    writeFiles(path, { 'a.txt': 'a, fixed\n' });
    const commit = await strategy.commit(repo, task, 'feat: a');
    await commit.undo();
    expect(await git(path, 'rev-parse', 'fix/scroll')).toBe(await git(path, 'rev-parse', 'main'));
    expect(await listUncommitted(path)).toContain('a.txt');
    const again = await strategy.commit(repo, task, 'feat: a again');
    await release();
    expect(again.treeHash).toBe(await git(path, 'rev-parse', 'fix/scroll^{tree}'));
    expect(await readBranchFile(path, 'fix/scroll', 'a.txt')).toBe('a, fixed');
  });

  test('a task’s uncommitted edits stay its own between runs, and another task cannot take or touch them', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    const releaseFirst = await strategy.claim(repo, first);
    writeFiles(path, { 'a.txt': 'a, half done\n' });
    await releaseFirst();

    await editAndCommit(strategy, repo, second, { 'banner.txt': 'banner\n' });
    expect(await git(path, 'show', '--name-only', '--format=', 'feat/banner')).toBe('banner.txt');

    const releaseSecond = await strategy.claim(repo, second);
    writeFiles(path, { 'a.txt': 'a, overwritten\n' });
    await expect(strategy.commit(repo, second, 'feat: x')).rejects.toThrow('a.txt');
    writeFiles(path, { 'a.txt': 'a, half done\n' });
    await releaseSecond();

    await editAndCommit(strategy, repo, first, {});
    expect(await readBranchFile(path, 'fix/scroll', 'a.txt')).toBe('a, half done');
  });

  test('GitButler’s own refusal to commit lines another branch changed reaches the agent', async () => {
    const { repo, strategy } = await createWorkspace();
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    await editAndCommit(strategy, repo, first, { 'a.txt': 'a, fixed\n' });
    await expect(editAndCommit(strategy, repo, second, { 'a.txt': 'a, fixed\nand more\n' })).rejects.toThrow(
      'GitButler did not commit the changes to feat/banner:'
    );
  });

  test('a change to lines another task’s branch changed stacks the task’s branch on that one when allowed', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    await editAndCommit(strategy, repo, first, { 'a.txt': 'a, fixed\n' });
    await editAndCommit(strategy, repo, second, { 'banner.txt': 'banner\n' });
    const asked: string[] = [];
    const info = spyOn(log, 'info').mockImplementation(() => undefined);
    const commit = await editAndCommit(
      strategy,
      repo,
      second,
      { 'a.txt': 'a, fixed\nand more\n' },
      (branch) => {
        asked.push(branch);
        return true;
      }
    );
    info.mockRestore();
    expect(asked).toEqual(['fix/scroll']);
    expect(commit.stackedOn).toBe('fix/scroll');
    expect(commit.treeHash).toBe(await git(path, 'rev-parse', 'feat/banner^{tree}'));
    const status = await readButStatus(path);
    expect(status.stacks.map((stack) => stack.branches.map((branch) => branch.name))).toEqual([
      ['feat/banner', 'fix/scroll'],
    ]);
    expect(await readBranchFile(path, 'feat/banner', 'a.txt')).toBe('a, fixed\nand more');
    expect(await readBranchFile(path, 'feat/banner', 'banner.txt')).toBe('banner');
    expect(await git(path, 'merge-base', '--is-ancestor', 'fix/scroll', 'feat/banner').then(() => true)).toBe(
      true
    );
    expect(await listUncommitted(path)).toBe('');
  });

  test('a branch Shinsa may not stack on keeps GitButler’s refusal', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    await editAndCommit(strategy, repo, first, { 'a.txt': 'a, fixed\n' });
    const asked: string[] = [];
    await expect(
      editAndCommit(strategy, repo, second, { 'a.txt': 'a, fixed\nand more\n' }, (branch) => {
        asked.push(branch);
        return false;
      })
    ).rejects.toThrow('but move feat/banner --above fix/scroll');
    expect(asked).toEqual(['fix/scroll']);
    expect(await listApplied(path)).toEqual(['feat/banner', 'fix/scroll']);
    const status = await readButStatus(path);
    expect(status.stacks).toHaveLength(2);
  });

  test('one agent at a time changes files in the workspace; the next waits, or stops waiting when cancelled', async () => {
    const { repo } = await createWorkspace();
    const lease = new WorkspaceLock();
    const strategy = new GitButlerStrategy(createTempDir(), lease);
    const first = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const second = await startTask(strategy, repo, 'task-2', 'feat/banner');
    const release = await strategy.claim(repo, first);
    const again = await strategy.claim(repo, first);
    await again();
    let claimed = false;
    const waiting = strategy.claim(repo, second).then((next) => {
      claimed = true;
      return next;
    });
    await Bun.sleep(0);
    expect(claimed).toBe(false);
    expect(lease.selectOwner(repo.id)).toBe('task-1');
    await release();
    await (await waiting)();
    const cancel = new AbortController();
    const held = await strategy.claim(repo, first);
    const stopped = strategy.claim(repo, second, cancel.signal);
    cancel.abort(new Error('cancelled'));
    await expect(stopped).rejects.toThrow('cancelled');
    await held();
  });

  test('setting up again before any phase drops the task’s own scratch edits, as a fresh worktree would', async () => {
    const { repo, path, strategy } = await createWorkspace();
    writeFiles(path, { 'mine.txt': 'mine\n' });
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    const release = await strategy.claim(repo, task);
    writeFiles(path, { 'scratch.txt': 'from the investigation\n' });
    await release();
    await strategy.prepare(repo, task);
    expect(existsSync(join(path, 'scratch.txt'))).toBe(false);
    expect(readFileSync(join(path, 'mine.txt'), 'utf8')).toBe('mine\n');
    const worked = await startTask(strategy, repo, 'task-2', 'feat/banner');
    const second = await strategy.claim(repo, worked);
    writeFiles(path, { 'kept.txt': 'half a phase\n' });
    await second();
    await strategy.prepare(repo, { ...worked, phaseReports: [{}] as Task['phaseReports'] });
    expect(existsSync(join(path, 'kept.txt'))).toBe(true);
  });

  test('a branch is reused while applied, applied again when it was not, and named anew when taken', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    expect(await strategy.prepare(repo, task)).toEqual({ path, branch: 'fix/scroll' });
    await runCommandOrThrow(['but', 'unapply', 'fix/scroll', '--json'], path);
    expect(await strategy.prepare(repo, task)).toEqual({ path, branch: 'fix/scroll' });
    expect(await listApplied(path)).toEqual(['fix/scroll']);
    const other = await startTask(strategy, repo, 'task-2', 'fix/scroll');
    expect(other.branch).toBe('fix/scroll-2');
  });

  test('a stacked round gets its branch on top of the round below', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const base = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    await editAndCommit(strategy, repo, base, { 'a.txt': 'a, fixed\n' });
    const draft = createTask({
      id: 'task-1',
      branch: 'fix/scroll-more',
      worktreePath: null,
      workspace: 'gitbutler',
      rounds: [
        createRound({
          number: 1,
          status: 'shipped',
          branch: 'fix/scroll',
          pullRequest: { number: 7, url: 'https://github.com/acme/app/pull/7', state: 'open', base: 'main' },
        }),
        createRound({ number: 2, status: 'active', branch: null, base: 'fix/scroll', shipping: 'stacked' }),
      ],
    });
    const stacked = await strategy.prepare(repo, draft);
    expect(stacked.branch).toBe('fix/scroll-more');
    await git(path, 'merge-base', '--is-ancestor', 'fix/scroll', 'fix/scroll-more');
    expect(await listApplied(path)).toEqual(['fix/scroll', 'fix/scroll-more']);
  });

  test('pushes the task’s branch and answers its commit', async () => {
    const { repo, path, origin, strategy } = await createWorkspace();
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    await editAndCommit(strategy, repo, task, { 'a.txt': 'a, fixed\n' });
    const sha = await strategy.push(repo, task);
    expect(sha).toBe(await git(path, 'rev-parse', 'fix/scroll'));
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/scroll')).toBe(sha);
  });

  test('a cancelled task’s branch is unapplied and its untouched edits discarded; a merged one stays for GitButler', async () => {
    const { repo, path, strategy } = await createWorkspace();
    const cancelled = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    await editAndCommit(strategy, repo, cancelled, { 'a.txt': 'a, fixed\n' });
    const release = await strategy.claim(repo, cancelled);
    writeFiles(path, { 'scratch.txt': 'scratch\n', 'b.txt': 'b, agent\n' });
    await release();
    writeFiles(path, { 'b.txt': 'b, then mine\n' });
    await strategy.remove(repo, { ...cancelled, stage: 'cancelled' });
    expect(await listApplied(path)).toEqual([]);
    expect(existsSync(join(path, 'scratch.txt'))).toBe(false);
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('a\n');
    expect(readFileSync(join(path, 'b.txt'), 'utf8')).toBe('b, then mine\n');

    const merged = await startTask(strategy, repo, 'task-2', 'feat/banner');
    await editAndCommit(strategy, repo, merged, { 'banner.txt': 'banner\n' });
    await strategy.remove(repo, {
      ...merged,
      stage: 'merged',
      pullRequest: { state: 'merged' } as Task['pullRequest'],
    });
    expect(await listApplied(path)).toEqual(['feat/banner']);
    await strategy.remove(repo, { ...merged, branch: null });
  });

  test('a repository that is not a GitButler workspace is refused before anything changes', async () => {
    const { repo, path } = await createGitRepo();
    const strategy = new GitButlerStrategy(createTempDir());
    expect(() => strategy.prepare(repo, createTask({ worktreePath: null }))).toThrow(
      `${path} is not a GitButler workspace. Run \`but setup\` in it, or choose another place for agents to work in Settings → Projects.`
    );
    const workspace = await createWorkspace();
    expect(() =>
      workspace.strategy.prepare(workspace.repo, createTask({ branch: null, worktreePath: null }))
    ).toThrow('The task has no branch yet.');
  });

  test('a ledger write that fails gives the claim back', async () => {
    const { repo } = await createWorkspace();
    const dataDir = createTempDir();
    const strategy = new GitButlerStrategy(join(dataDir, 'missing', 'deeper'));
    const task = await startTask(strategy, repo, 'task-1', 'fix/scroll');
    rmSync(dataDir, { recursive: true, force: true });
    writeFiles(dataDir, { missing: 'a file where a folder should be' });
    await expect(strategy.claim(repo, task)).rejects.toThrow();
    rmSync(join(dataDir, 'missing'), { force: true });
    const release = await strategy.claim(repo, task);
    await release();
  });
});
