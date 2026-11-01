import { describe, expect, test } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import { EffectRunner } from '../../src/runtime/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  NO_SHARES,
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

function setup(task: Partial<Task>, repo: Partial<ReturnType<typeof createRepo>>) {
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    state.tasks['task-1'] = createTask(task);
  });
  const config = createTestConfig(createTempDir());
  const runner = new EffectRunner(stub.engine, config, RUNS, BRIEFINGS, {
    shares: NO_SHARES,
    resolveLogin: () => Promise.resolve(null),
    triage: () => Promise.resolve(null),
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
  test('the setup check stops a task whose repository cannot hold agents the way you chose', async () => {
    const made = await createGitRepo();
    const { path } = made;
    const repo = { ...made.repo, checkCommands: ['true'] };
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
});
