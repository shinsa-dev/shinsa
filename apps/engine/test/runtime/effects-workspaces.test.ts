import { describe, expect, test } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import { EffectRunner } from '../../src/runtime/index.ts';
import { listAppliedBranches, readButStatus } from '../../src/workspaces/but.ts';
import { Workspaces } from '../../src/workspaces/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  overrideEnv,
  startGitButler,
  until,
  writeFiles,
} from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';

const RUNS = { quiesce: () => Promise.resolve() } as unknown as RunSupervisor;

const BRIEFINGS = { schedule: () => undefined } as unknown as Briefings;

let effects = 0;

function createContext() {
  effects += 1;
  return { key: `workspace-effect-${effects}`, attempt: 1, signal: new AbortController().signal };
}

function setup(task: Partial<Task>, repo: Partial<ReturnType<typeof createRepo>>, workspaces?: Workspaces) {
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    state.tasks['task-1'] = createTask(task);
  });
  const config = createTestConfig(createTempDir());
  const runner = new EffectRunner(stub.engine, config, RUNS, BRIEFINGS, {
    resolveLogin: () => Promise.resolve(null),
    triage: () => Promise.resolve(null),
    ...(workspaces ? { workspaces } : {}),
  });
  return { ...stub, runner, config };
}

const CHANGE: Task['pipeline'] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

describe('effects where agents work', () => {
  test('a GitButler task gets its branch in the checkout, and the checkout is where it works', async () => {
    const { repo, path } = await createGitRepo();
    await startGitButler(path);
    const { runner, dispatched } = setup(
      { stage: 'triage', worktreePath: null, workspace: 'gitbutler' },
      { ...repo, workspace: 'gitbutler' }
    );
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(dispatched[0]).toEqual({
      type: 'worktree.ready',
      taskId: 'task-1',
      path,
      branch: 'fix/tab-scroll',
    });
    expect(listAppliedBranches(await readButStatus(path))).toEqual(['fix/tab-scroll']);
  });

  test('the setup check stops a task whose repository cannot hold agents the way you chose', async () => {
    const made = await createGitRepo();
    const { path } = made;
    const repo = { ...made.repo, checkCommands: ['true'] };
    const gitbutler = setup(
      { stage: 'triage', pipeline: CHANGE, worktreePath: null },
      { ...repo, workspace: 'gitbutler' }
    );
    const restore = overrideEnv({ FAKE_BUT_VERSION: '0.22.3' });
    await gitbutler.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    restore();
    expect(gitbutler.dispatched[0]).toMatchObject({
      type: 'config.record',
      problems: [{ kind: 'workspace', detail: expect.stringContaining('is not a GitButler workspace') }],
    });
    writeFiles(path, { 'mine.txt': 'mine\n' });
    const checkout = setup(
      { stage: 'triage', pipeline: CHANGE, worktreePath: null },
      { ...repo, workspace: 'main_checkout' }
    );
    await checkout.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(checkout.dispatched[0]).toMatchObject({ problems: [{ kind: 'workspace' }] });
    const answer = setup({ stage: 'triage', pipeline: ['answer'] }, { ...repo, workspace: 'main_checkout' });
    await answer.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(answer.dispatched[0]).toMatchObject({ problems: [] });
    const missing = setup(
      { stage: 'triage', pipeline: CHANGE },
      { ...repo, path: `${path}-gone`, workspace: 'main_checkout' }
    );
    await missing.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(missing.dispatched[0]).toMatchObject({ problems: [{ kind: 'repository' }] });
  });

  test('a GitButler task’s checks wait for another task’s agent to stop changing files', async () => {
    const { repo, path } = await createGitRepo();
    await startGitButler(path);
    const workspaces = new Workspaces({ dataDir: createTempDir(), worktreesDir: createTempDir() });
    const butler = { ...repo, workspace: 'gitbutler' as const, checkCommands: ['true'] };
    const other = createTask({ id: 'task-2', worktreePath: path, workspace: 'gitbutler' });
    const release = await workspaces.resolve(other).claim(butler, other);
    const { runner, dispatched } = setup(
      { stage: 'checking', worktreePath: path, workspace: 'gitbutler' },
      butler,
      workspaces
    );
    const checks = runner.apply(
      {
        kind: 'checks.run',
        taskId: 'task-1',
        round: 1,
        checks: [{ id: 'r1', label: 'true', command: 'true' }],
        coverage: false,
      },
      createContext()
    );
    await Bun.sleep(20);
    expect(dispatched).toEqual([]);
    await release();
    await checks;
    await until('the checks to be recorded', () => dispatched.length === 1);
    expect(dispatched[0]).toMatchObject({ type: 'checks.record', results: [{ outcome: 'pass' }] });
  });

  test('a main-checkout task pushes its own branch from the checkout', async () => {
    const { repo, path, origin } = await createGitRepo();
    await git(path, 'checkout', '-q', '-b', 'fix/tab-scroll');
    writeFiles(path, { 'a.txt': 'a\n' });
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'fix: a');
    const { runner, dispatched } = setup(
      {
        stage: 'shipping',
        worktreePath: path,
        workspace: 'main_checkout',
        pullRequest: {
          number: 7,
          url: 'https://github.com/acme/app/pull/7',
          state: 'open',
        } as Task['pullRequest'],
      },
      { ...repo, workspace: 'main_checkout' }
    );
    await runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    const sha = await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll');
    expect(dispatched).toEqual([
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'pushing', hook: false } },
      { type: 'pull_request.record_push', taskId: 'task-1', sha },
    ]);
    await runner.stop();
  });

  test('your uncommitted edits from the Code tab are committed before the push', async () => {
    const { repo, path, origin } = await createGitRepo();
    await git(path, 'checkout', '-q', '-b', 'fix/tab-scroll');
    writeFiles(path, { 'a.txt': 'a, by you\n' });
    const { runner, dispatched } = setup(
      {
        stage: 'shipping',
        worktreePath: path,
        workspace: 'main_checkout',
        editedPaths: ['a.txt'],
        pullRequest: {
          number: 7,
          url: 'https://github.com/acme/app/pull/7',
          state: 'open',
        } as Task['pullRequest'],
      },
      { ...repo, workspace: 'main_checkout' }
    );
    await runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    expect(await git(origin, 'show', 'refs/heads/fix/tab-scroll:a.txt')).toBe('a, by you');
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: apply the edits made in the Code tab');
    expect(dispatched[0]).toEqual({
      type: 'task.commit_edits',
      taskId: 'task-1',
      treeHash: await git(path, 'rev-parse', 'HEAD^{tree}'),
    });
    expect(dispatched[2]).toMatchObject({ type: 'pull_request.record_push' });
    await runner.stop();
  });

  test('edits approved at the review are committed before the checks run, and only then', async () => {
    const { repo, path } = await createGitRepo();
    await git(path, 'checkout', '-q', '-b', 'fix/tab-scroll');
    writeFiles(path, { 'a.txt': 'a, by you\n' });
    const checked = { ...repo, workspace: 'main_checkout' as const, checkCommands: ['true'] };
    const task = {
      stage: 'checking',
      worktreePath: path,
      workspace: 'main_checkout',
      editedPaths: ['a.txt'],
    };
    const approved = setup({ ...task, approvedEdits: 'review' } as Partial<Task>, checked);
    await approved.runner.apply(
      {
        kind: 'checks.run',
        taskId: 'task-1',
        round: 0,
        checks: [{ id: 'r1', label: 'true', command: 'true' }],
        coverage: false,
      },
      createContext()
    );
    expect(approved.dispatched.map((command) => command.type)).toEqual([
      'task.commit_edits',
      'checks.record',
    ]);
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: apply the edits made in the Code tab');

    writeFiles(path, { 'a.txt': 'a, by you again\n' });
    const plain = setup(task as Partial<Task>, checked);
    await plain.runner.apply(
      {
        kind: 'checks.run',
        taskId: 'task-1',
        round: 0,
        checks: [{ id: 'r1', label: 'true', command: 'true' }],
        coverage: false,
      },
      createContext()
    );
    expect(plain.dispatched.map((command) => command.type)).toEqual(['checks.record']);
    expect(await git(path, 'status', '--porcelain')).toBe('M a.txt');
  });

  test('updating a GitButler workspace runs `but pull`, then hands the task back to its agent', async () => {
    const { repo, path } = await createGitRepo();
    await startGitButler(path);
    const butler = { ...repo, workspace: 'gitbutler' as const };
    const shipping = setup(
      { stage: 'shipping', worktreePath: path, workspace: 'gitbutler', branch: 'fix/tab-scroll' },
      butler
    );
    await shipping.runner.apply(
      { kind: 'workspace.update', taskId: 'task-1', guidance: 'Keep both.' },
      createContext()
    );
    expect(shipping.dispatched).toEqual([
      { type: 'task.record_workspace_update', taskId: 'task-1', guidance: 'Keep both.' },
    ]);
    const moved = setup({ stage: 'fixing', worktreePath: path, workspace: 'gitbutler' }, butler);
    await moved.runner.apply({ kind: 'workspace.update', taskId: 'task-1', guidance: null }, createContext());
    expect(moved.dispatched).toEqual([]);
  });
});
