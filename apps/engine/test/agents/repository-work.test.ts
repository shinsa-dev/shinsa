import { describe, expect, spyOn, test } from 'bun:test';
import type { Repo, ShinsaCommand, Task } from '@shinsa/core';
import { RepositoryWork } from '../../src/agents/repository-work.ts';
import { createWorktree } from '../../src/git/index.ts';
import { log } from '../../src/log/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';
import { createRun, createStubEngine, createTask } from '../helpers/state.ts';

async function commitAll(path: string, message: string) {
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', message);
}

async function createWorkingTask(
  repo: Repo,
  id: string,
  files: Record<string, string>,
  extra: Partial<Task> = {}
) {
  const worktree = await createWorktree(repo, createTempDir(), id, `feat/${id}`, null);
  writeFiles(worktree.path, files);
  await commitAll(worktree.path, `feat: ${id}`);
  return createTask({ id, title: `Task ${id}`, branch: `feat/${id}`, worktreePath: worktree.path, ...extra });
}

async function setup(tasks: (repo: Repo) => Promise<Task[]>) {
  const { repo } = await createGitRepo();
  const created = await tasks(repo);
  const stub = createStubEngine((state) => {
    state.repos[repo.id] = repo;
    for (const task of created) state.tasks[task.id] = task;
  });
  return { repo, stub, work: new RepositoryWork(stub.engine) };
}

function overlapsOf(dispatched: ShinsaCommand[]) {
  return dispatched.filter((command) => command.type === 'task.record_overlaps');
}

describe('the other work in a task’s repository', () => {
  test('lists each other open task with the files it changed, marking the ones this task changes too', async () => {
    const { stub, work } = await setup(async (repo) => [
      await createWorkingTask(repo, 'mine', { 'src/a.ts': '1\n' }),
      await createWorkingTask(repo, 'theirs', { 'src/a.ts': '2\n', 'src/b.ts': '2\n' }, { updatedAt: 5 }),
    ]);
    stub.state.runs.run1 = createRun({ id: 'run1', taskId: 'theirs' });
    const text = await work.describe('mine');
    expect(text).toContain('[Task theirs](shinsa://task/theirs) · building · branch feat/theirs');
    expect(text).toContain('an agent is working on it now');
    expect(text).toContain('  Changed files: src/a.ts, src/b.ts. This task changes src/a.ts too.');
  });

  test('a task whose checkout cannot be read lists its files as not known', async () => {
    const { stub, work } = await setup(async (created) => [
      await createWorkingTask(created, 'mine', { 'src/a.ts': '1\n' }),
    ]);
    stub.state.tasks.broken = createTask({ id: 'broken', title: 'Broken', worktreePath: createTempDir() });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const text = await work.describe('mine');
    expect(text).toContain('  Changed files: not known.');
    expect(warn).toHaveBeenCalledWith(
      '[RepositoryWork] Could not list the files a task changed',
      expect.objectContaining({ taskId: 'broken' })
    );
    warn.mockRestore();
  });

  test('records the files two tasks both change for each of them, the plan’s named files included', async () => {
    const { stub, work } = await setup(async (repo) => [
      await createWorkingTask(repo, 'mine', { 'src/a.ts': '1\n' }),
      await createWorkingTask(repo, 'theirs', { 'src/a.ts': '2\n', 'src/plan.ts': '2\n' }),
      await createWorkingTask(repo, 'apart', { 'src/z.ts': '3\n' }),
    ]);
    await work.recordOverlaps('mine', ['src/plan.ts']);
    expect(overlapsOf(stub.dispatched)).toEqual([
      {
        type: 'task.record_overlaps',
        taskId: 'mine',
        overlaps: [{ taskId: 'theirs', paths: ['src/a.ts', 'src/plan.ts'] }],
        from: 'mine',
      },
      {
        type: 'task.record_overlaps',
        taskId: 'theirs',
        overlaps: [{ taskId: 'mine', paths: ['src/a.ts', 'src/plan.ts'] }],
        from: 'mine',
      },
    ]);
    const ids = stub.commandIds.filter((id) => id?.startsWith('overlaps:'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toStartWith('overlaps:mine:');
    await work.recordOverlaps('mine', ['src/plan.ts']);
    expect(stub.commandIds.filter((id) => id?.startsWith('overlaps:')).slice(2)).toEqual(ids);
  });

  test('records nothing for a task alone in its repository, and logs a refused record', async () => {
    const alone = await setup(async (repo) => [await createWorkingTask(repo, 'mine', { 'src/a.ts': '1\n' })]);
    await alone.work.recordOverlaps('mine', ['src/a.ts']);
    expect(overlapsOf(alone.stub.dispatched)).toEqual([]);
    const pair = await setup(async (repo) => [
      await createWorkingTask(repo, 'mine', { 'src/a.ts': '1\n' }),
      await createWorkingTask(repo, 'theirs', { 'src/a.ts': '2\n' }),
    ]);
    pair.stub.reject((command) => command.type === 'task.record_overlaps');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await pair.work.recordOverlaps('mine', []);
    expect(warn).toHaveBeenCalledWith(
      '[RepositoryWork] Could not record the files another task changes too',
      expect.objectContaining({ taskId: 'mine' })
    );
    warn.mockRestore();
  });
});
