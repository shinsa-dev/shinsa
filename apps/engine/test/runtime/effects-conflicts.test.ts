import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, ShinsaState, Task } from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import { log } from '../../src/log/index.ts';
import { EffectRunner } from '../../src/runtime/index.ts';
import { Workspaces } from '../../src/workspaces/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  overrideEnv,
  startGitButler,
  writeFiles,
} from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';

const RUNS = { quiesce: () => Promise.resolve() } as unknown as RunSupervisor;

const BRIEFINGS = { schedule: () => undefined } as unknown as Briefings;

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

let effects = 0;

function createContext() {
  effects += 1;
  return { key: `conflict-effect-${effects}`, signal: new AbortController().signal };
}

function setup(tasks: Partial<Task>[], repo: Partial<Repo>, workspaces?: Workspaces) {
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    for (const task of tasks) state.tasks[task.id ?? 'task-1'] = createTask(task);
  });
  const runner = new EffectRunner(stub.engine, createTestConfig(createTempDir()), RUNS, BRIEFINGS, {
    resolveLogin: () => Promise.resolve(null),
    triage: () => Promise.resolve(null),
    ...(workspaces ? { workspaces } : {}),
  });
  return { ...stub, runner };
}

async function commitAs(workspaces: Workspaces, repo: Repo, task: Task, files: Record<string, string>) {
  const strategy = workspaces.resolve(task);
  const release = await strategy.claim(repo, task);
  writeFiles(repo.path, files);
  try {
    return await strategy.commit(repo, task, `feat: ${task.id}`, () => true);
  } finally {
    await release();
  }
}

async function stackTwo() {
  const made = await createGitRepo({ files: { 'a.txt': 'a\n' } });
  await startGitButler(made.path);
  const repo = { ...made.repo, workspace: 'gitbutler' as const };
  const workspaces = new Workspaces({ dataDir: createTempDir(), worktreesDir: createTempDir() });
  const strategy = workspaces.resolve({ workspace: 'gitbutler' });
  const tasks: Task[] = [];
  for (const [id, branch] of [
    ['task-1', 'fix/scroll'],
    ['task-2', 'feat/banner'],
  ] as const) {
    const draft = createTask({ id, branch, worktreePath: null, workspace: 'gitbutler' });
    const checkout = await strategy.prepare(repo, draft);
    tasks.push(createTask({ id, branch: checkout.branch, worktreePath: made.path, workspace: 'gitbutler' }));
  }
  const [below, above] = tasks as [Task, Task];
  await commitAs(workspaces, repo, below, { 'a.txt': 'a, fixed\n' });
  const info = spyOn(log, 'info').mockImplementation(() => undefined);
  await commitAs(workspaces, repo, above, { 'a.txt': 'a, fixed\nand more\n' });
  info.mockRestore();
  return { ...made, repo, workspaces, below, above };
}

describe('conflicts in a GitButler stack', () => {
  test('cancelling the task below asks for the conflicts it leaves on the task above, and that task is not pushed', async () => {
    const { repo, origin, workspaces, below, above } = await stackTwo();
    const pullRequest = { number: 7, url: 'https://github.com/acme/app/pull/7', state: 'open' };
    const { runner, dispatched } = setup(
      [
        { ...below, stage: 'cancelled' },
        { ...above, stage: 'shipping', pullRequest: pullRequest as Task['pullRequest'] },
      ],
      repo,
      workspaces
    );
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    warn.mockRestore();
    expect(dispatched).toEqual([
      { type: 'worktree.gone', taskId: 'task-1' },
      { type: 'task.record_conflict', taskId: 'task-2', branch: 'feat/banner' },
    ]);

    await runner.apply({ kind: 'pull_request.push', taskId: 'task-2' }, createContext());
    expect(dispatched.slice(2)).toEqual([
      { type: 'task.record_conflict', taskId: 'task-2', branch: 'feat/banner' },
    ]);
    expect(await git(origin, 'branch', '--list', 'feat/banner')).toBe('');
    await runner.stop();
  });

  test('a removal whose workspace cannot be read for conflicts is logged and records nothing more', async () => {
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      [{ stage: 'cancelled', worktreePath: repo.path, workspace: 'gitbutler' }],
      { ...repo, workspace: 'gitbutler' }
    );
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const restore = overrideEnv({ FAKE_BUT_MISSING: '1' });
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    restore();
    expect(warn).toHaveBeenCalledWith(
      '[Effects] Could not read which branches are conflicted',
      expect.objectContaining({ taskId: 'task-1' })
    );
    warn.mockRestore();
    expect(dispatched).toEqual([{ type: 'worktree.gone', taskId: 'task-1' }]);
  });

  test('a main checkout leaves no conflicted branches behind', async () => {
    const { repo, path } = await createGitRepo();
    await git(path, 'checkout', '-q', '-b', 'fix/tab-scroll');
    const { runner, dispatched } = setup(
      [{ stage: 'cancelled', worktreePath: path, workspace: 'main_checkout' }],
      { ...repo, workspace: 'main_checkout' }
    );
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(dispatched).toEqual([{ type: 'worktree.gone', taskId: 'task-1' }]);
  });
});

describe('a pull request that conflicts with its base', () => {
  function writeConflictingPull(base: string) {
    const path = join(createTempDir(), 'gh.json');
    const pull = {
      number: 7,
      head: 'fix/tab-scroll',
      base,
      state: 'OPEN',
      checks: 'passing',
      mergeable: 'CONFLICTING',
      unresolved: 0,
      mergedWith: null,
    };
    writeFileSync(path, JSON.stringify({ next: 8, defaultChecks: 'passing', pulls: [pull], calls: [] }));
    restores.push(overrideEnv({ FAKE_GH_STATE: path }));
  }

  test('its base is fetched before it is recorded, so the agent merges the latest', async () => {
    const { repo, path } = await createGitRepo();
    const stale = await git(path, 'rev-parse', 'origin/main');
    writeFiles(path, { 'moved.txt': 'moved\n' });
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'feat: move main');
    await git(path, 'push', '-q', 'origin', 'main');
    const moved = await git(path, 'rev-parse', 'HEAD');
    await git(path, 'update-ref', 'refs/remotes/origin/main', stale);
    writeConflictingPull('main');
    const { runner, dispatched } = setup([{ stage: 'shipping', pullRequest: null }], repo);
    await runner.syncPullRequest('task-1');
    expect(await git(path, 'rev-parse', 'origin/main')).toBe(moved);
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record']);
  });

  test('a base that cannot be fetched is logged, and the pull request is still recorded', async () => {
    const { repo } = await createGitRepo();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    for (const base of ['gone', '-x']) {
      writeConflictingPull(base);
      const { runner, dispatched } = setup([{ stage: 'shipping', pullRequest: null }], repo);
      await runner.syncPullRequest('task-1');
      expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record']);
    }
    expect(warn.mock.calls.map(([message, fields]) => [message, (fields as { base: string }).base])).toEqual([
      ['[Watch] Could not fetch the base of a conflicting pull request; the agent fetches it', 'gone'],
      ['[Watch] Could not fetch the base of a conflicting pull request; the agent fetches it', '-x'],
    ]);
    warn.mockRestore();
  });
});
