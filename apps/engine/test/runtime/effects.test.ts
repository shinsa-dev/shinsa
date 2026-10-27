import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPullRequestWatch,
  type Evidence,
  evaluatePullRequestWatch,
  type PlanDocument,
  type PullRequest,
  type ShinsaCommand,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import { resolveScratchPath, type ServerConfig } from '../../src/config/index.ts';
import { createWorktree, inspectRepo } from '../../src/git/index.ts';
import * as github from '../../src/github/index.ts';
import { log } from '../../src/log/index.ts';
import { EffectRunner, type EffectRunnerOptions, Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { resolveTriage } from '../../src/triage/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  overrideEnv,
  type TestRepo,
  until,
  writeFiles,
} from '../helpers/index.ts';
import { createRepo, createRound, createStubEngine, createTask } from '../helpers/state.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

interface FakeGitHub {
  pulls: Record<string, unknown>[];
  calls: string[][];
  failReads?: number;
  mergeQueue?: boolean;
}

function useFakeGitHub(pulls: unknown[] = [], extra: Partial<FakeGitHub> = {}) {
  const path = join(createTempDir(), 'gh.json');
  const write = (state: object) => writeFileSync(path, JSON.stringify(state));
  write({ next: pulls.length + 1, defaultChecks: 'passing', pulls, calls: [], ...extra });
  restores.push(overrideEnv({ FAKE_GH_STATE: path }));
  const read = () => JSON.parse(readFileSync(path, 'utf8')) as FakeGitHub;
  return Object.assign(read, {
    change: (patch: (state: FakeGitHub) => void) => {
      const state = read();
      patch(state);
      write(state);
    },
  });
}

function useFailingGh(failing: string, code = 1, message = 'gh is down') {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${failing}"*) echo "${message}" >&2; exit ${code};; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
}

function useHangingGh(failing: string) {
  const dir = createTempDir();
  const pidFile = join(dir, 'gh.pid');
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${failing}"*) echo $$ > "${pidFile}"; exec sleep 30;; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
  return () => Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : 0);
}

function useHeldGh(held: string) {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  const release = join(dir, 'release');
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/bin/sh',
      `case "$*" in *"${held}"*) if mkdir "${dir}/taken" 2>/dev/null; then`,
      `  out=$("${real}" "$@"); code=$?`,
      `  while [ ! -f "${release}" ]; do sleep 0.01; done`,
      `  printf '%s\\n' "$out"; exit $code`,
      'fi;; esac',
      `exec "${real}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
  return () => writeFileSync(release, '');
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function useHangingFetch(path: string) {
  const dir = createTempDir();
  const pidFile = join(dir, 'fetch.pid');
  const uploadPack = join(dir, 'upload-pack');
  writeFileSync(uploadPack, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`, { mode: 0o755 });
  await git(path, 'config', 'remote.origin.uploadpack', uploadPack);
  return () => Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : 0);
}

let effectCount = 0;

function createContext(signal: AbortSignal = new AbortController().signal) {
  effectCount += 1;
  return { key: `effect-${effectCount}`, signal };
}

function createRuns() {
  const calls: string[] = [];
  const runs = {
    execute: (runId: string) => {
      calls.push(`execute:${runId}`);
      return Promise.resolve();
    },
    cancel: (runId: string) => {
      calls.push(`cancel:${runId}`);
      return Promise.resolve();
    },
    steer: (runId: string, text: string, cause: string) => {
      calls.push(`steer:${runId}:${text}:${cause}`);
      return Promise.resolve();
    },
    resolveQuestion: (gateId: string) => {
      calls.push(`question:${gateId}`);
      return Promise.resolve();
    },
    quiesce: (taskId: string) => {
      calls.push(`quiesce:${taskId}`);
      return Promise.resolve();
    },
  };
  return { runs: runs as unknown as RunSupervisor, calls };
}

function createBriefings() {
  let scheduled = 0;
  return {
    briefings: { schedule: () => (scheduled += 1) } as unknown as Briefings,
    scheduled: () => scheduled,
  };
}

function setup(
  patch: (state: ShinsaState) => void = () => undefined,
  options: Partial<EffectRunnerOptions> & { config?: Partial<ServerConfig> } = {}
) {
  const stub = createStubEngine(patch);
  const config = createTestConfig(createTempDir(), options.config);
  const { runs, calls } = createRuns();
  const briefings = createBriefings();
  const runner = new EffectRunner(stub.engine, config, runs, briefings.briefings, {
    resolveLogin: () => Promise.resolve(null),
    triage: (state, task, local) => resolveTriage(state, task, local, () => Promise.resolve(null)),
    ...options,
  });
  return { ...stub, config, runner, calls, scheduled: briefings.scheduled };
}

function withTask(task: Partial<Task>, repo: Partial<ReturnType<typeof createRepo>> = {}) {
  return (state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    state.tasks['task-1'] = createTask(task);
  };
}

const PULL: PullRequest = {
  number: 7,
  url: 'https://github.com/acme/app/pull/7',
  base: 'main',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  headSha: null,
  updatedAt: 1,
};

function fakePull(head: string, overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    head,
    base: 'main',
    state: 'OPEN',
    checks: 'passing',
    mergeable: 'MERGEABLE',
    unresolved: 0,
    mergedWith: null,
    ...overrides,
  };
}

function records(dispatched: ShinsaCommand[]) {
  return dispatched.flatMap((command) => (command.type === 'pull_request.record' ? [command] : []));
}

async function createShippingRepo(): Promise<TestRepo & { worktree: string }> {
  const repo = await createGitRepo();
  const worktree = await createWorktree(repo.repo, createTempDir(), 'task-1', 'fix/tab-scroll', null);
  writeFiles(worktree.path, { 'a.txt': 'a' });
  await git(worktree.path, 'add', '-A');
  await git(worktree.path, 'commit', '-q', '-m', 'fix: a');
  return { ...repo, worktree: worktree.path };
}

describe('routing effects', () => {
  test('run effects go to the supervisor, a steer with its effect key as the cause, and a briefing request to the briefings', async () => {
    const { runner, calls, scheduled } = setup();
    await runner.apply({ kind: 'run.execute', runId: 'r1' }, createContext());
    await runner.apply({ kind: 'run.cancel', runId: 'r1' }, createContext());
    const steer = createContext();
    await runner.apply({ kind: 'run.steer', runId: 'r1', text: 'hi' }, steer);
    await runner.apply({ kind: 'question.resolve', gateId: 'g1' }, createContext());
    await runner.apply({ kind: 'briefing.request', projectId: null }, createContext());
    expect(calls).toEqual(['execute:r1', 'cancel:r1', `steer:r1:hi:${steer.key}`, 'question:g1']);
    expect(scheduled()).toBe(1);
  });

  test('an effect that failed for good opens one failure gate on its task, under an id the effect decides', async () => {
    const { runner, dispatched, commandIds } = setup();
    await runner.reportExhausted({ kind: 'pull_request.push', taskId: 't1' }, 'push rejected', 'push-key');
    await runner.reportExhausted({ kind: 'run.execute', runId: 'r1' }, 'x', 'run-key');
    await runner.reportExhausted({ kind: 'pull_request.watch', taskId: 't1' }, 'x', 'watch-key');
    expect(dispatched).toEqual([
      { type: 'effect.fail', taskId: 't1', title: 'Could not push the fixes', detail: 'push rejected' },
    ]);
    expect(commandIds).toEqual(['push-key:effect.fail']);
  });
});

describe('triage', () => {
  test('a settled, unknown or already triaged task is left alone', async () => {
    const { runner, dispatched } = setup((state) => {
      state.tasks.done = createTask({ id: 'done', stage: 'cancelled', branch: null });
      state.tasks.triaged = createTask({ id: 'triaged' });
    });
    for (const taskId of ['done', 'triaged', 'missing']) {
      await runner.apply({ kind: 'task.triage', taskId }, createContext());
    }
    expect(dispatched).toEqual([]);
  });

  test('a triage that gives no answer is an error', async () => {
    const { runner } = setup(withTask({ branch: null, size: null, stage: 'triage', repoId: null }), {
      config: { roots: [createTempDir()] },
      triage: () => Promise.resolve(null),
    });
    await expect(runner.apply({ kind: 'task.triage', taskId: 'task-1' }, createContext())).rejects.toThrow(
      'Shinsa could not read the request'
    );
  });

  test('a request that needs no repository registers none and is triaged without one', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const eventLog = new EventLog(config.databasePath);
    const engine = new Engine(eventLog);
    await engine.dispatch({ type: 'task.create', request: 'Hey', repoId: null, mode: 'ask' });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      resolveLogin: () => Promise.resolve(null),
      triage: (state, current, local) =>
        resolveTriage(state, current, local, <T>() =>
          Promise.resolve({ title: 'Hey', repo: 'none', size: 'small', branch: 'chore/hey' } as T)
        ),
    });
    const context = createContext();
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, context);
    expect(eventLog.selectReceipt(`${context.key}:repo.register`)).toBeNull();
    expect(engine.state.repos).toEqual({});
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({
      repoId: null,
      worktreePath: null,
      stage: 'answering',
    });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });

  test('the repository is registered and the task triaged with its dependencies, each under the effect’s key', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const eventLog = new EventLog(config.databasePath);
    const engine = new Engine(eventLog);
    await engine.dispatch({ type: 'task.create', request: 'Earlier work', repoId: null });
    await engine.dispatch({ type: 'task.create', request: 'Fix the button', repoId: null });
    const [dependency, task] = Object.values(engine.state.tasks);
    const { runs } = createRuns();
    const runner = new EffectRunner(engine, config, runs, createBriefings().briefings, {
      resolveLogin: () => Promise.resolve(null),
      triage: (_state, _task, local) =>
        Promise.resolve({
          title: 'Fix the button',
          repoPath: local[0]?.path ?? '',
          size: 'small',
          branch: 'fix/button',
          waitsOn: dependency ? [dependency] : [],
        }),
    });
    const context = createContext();
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, context);
    expect(eventLog.selectReceipt(`${context.key}:repo.register`)).toMatchObject({ status: 'accepted' });
    expect(eventLog.selectReceipt(`${context.key}:task.triage`)).toMatchObject({ status: 'accepted' });
    const triaged = engine.state.tasks[task?.id ?? ''];
    expect(triaged).toMatchObject({
      title: 'Fix the button',
      branch: 'fix/button',
      waitsOn: [dependency?.id],
    });
    expect(Object.values(engine.state.repos).map((repo) => repo.name)).toEqual(['app']);
  });

  test('a repository outside the task’s project is bound while the task keeps its project, and filed by its owner', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const engine = new Engine(new EventLog(config.databasePath));
    await engine.dispatch({ type: 'project.write', project: { name: 'Shinsa', color: 'blue' } });
    const [project] = Object.values(engine.state.projects);
    const projectId = project?.id ?? '';
    await engine.dispatch({
      type: 'repo.register',
      repo: { name: 'shinsa', path: '/code/shinsa', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName: null,
      projectId,
    });
    await engine.dispatch({ type: 'task.create', request: 'Fix the button in app', repoId: null, projectId });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      resolveLogin: () => Promise.resolve(null),
      triage: (state, current, local) =>
        resolveTriage(state, current, local, <T>() =>
          Promise.resolve({ title: 'Fix the button', repo: 'app', size: 'small', branch: 'fix/button' } as T)
        ),
    });
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, createContext());
    const app = Object.values(engine.state.repos).find((repo) => repo.name === 'app');
    expect(app?.projectId).not.toBe(projectId);
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({ repoId: app?.id, projectId });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });

  test('the kind of task and its priority are sent with why triage chose them', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const engine = new Engine(new EventLog(config.databasePath));
    await engine.dispatch({ type: 'task.create', request: 'Why is the export slow?', repoId: null });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      resolveLogin: () => Promise.resolve(null),
      triage: (_state, _task, local) =>
        Promise.resolve({
          title: 'Find why the export is slow',
          repoPath: local[0]?.path ?? '',
          size: 'small',
          branch: 'fix/export-slow',
          waitsOn: [],
          shape: 'investigate',
          priority: 'high',
          reasons: {
            shape: 'It asks for a cause.',
            priority: 'Users are waiting.',
            start: 'Nothing comes first.',
          },
        }),
    });
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, createContext());
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({
      pipeline: ['investigate'],
      priority: 'high',
      triageDecisions: {
        shape: { value: 'investigate', why: 'It asks for a cause.' },
        priority: { value: 'high', why: 'Users are waiting.' },
        start: { value: [], why: 'Nothing comes first.' },
      },
    });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });
});

describe('the setup check', () => {
  test('asks only for what the task’s steps need: a default branch for a worktree, checks for a build', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const broken = { ...repo, defaultBranch: 'trunk' };
    const cases: [Task['pipeline'], string[]][] = [
      [['answer'], []],
      [['research'], []],
      [['investigate'], ['default_branch']],
      [['plan', 'operate'], ['default_branch']],
      [
        ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
        ['default_branch', 'check_commands'],
      ],
    ];
    for (const [pipeline, kinds] of cases) {
      const { runner, dispatched } = setup(withTask({ stage: 'triage', pipeline }, broken));
      await runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
      const problems = dispatched.flatMap((command) =>
        command.type === 'config.record' ? command.problems.map((problem): string => problem.kind) : []
      );
      expect(problems).toEqual(kinds);
      expect(dispatched.map((command) => command.type)).toEqual(['config.record']);
    }
    const started = setup(withTask({ stage: 'building' }, broken));
    await started.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(started.dispatched).toEqual([]);
  });

  test('a task with no repository finds one when its work needs it, and binds it with what its check found', async () => {
    const { repo, root } = await createGitRepo({ remote: false });
    const { path } = await inspectRepo(repo.path);
    const asked: string[] = [];
    const change = withTask(
      { stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] },
      { ...repo, path }
    );
    const found = setup(change, {
      config: { roots: [root] },
      findRepository: (_state, task, local) => {
        asked.push(`${task.id}:${local.map((candidate) => candidate.name).join(',')}`);
        return Promise.resolve(repo.path);
      },
    });
    const context = createContext();
    await found.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, context);
    expect(asked).toEqual(['task-1:app']);
    expect(found.commandIds).toEqual([`${context.key}:config.record`]);
    expect(found.dispatched).toEqual([
      { type: 'config.record', taskId: 'task-1', problems: [], repoId: 'repo-1' },
    ]);

    const none = setup(change, { findRepository: () => Promise.resolve(null) });
    await none.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(none.dispatched).toEqual([{ type: 'config.record', taskId: 'task-1', problems: [] }]);
  });

  test('a question with no repository asks for none, and a moved-on or cancelled check records nothing', async () => {
    const asked: string[] = [];
    const findRepository = () => {
      asked.push('asked');
      return Promise.resolve(null);
    };
    const question = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['answer'] }), {
      findRepository,
    });
    await question.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(question.dispatched).toEqual([{ type: 'config.record', taskId: 'task-1', problems: [] }]);
    const defaults = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] }));
    await defaults.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(defaults.dispatched).toHaveLength(1);
    const moved = setup(withTask({ stage: 'answering', repoId: null }), { findRepository });
    await moved.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    const controller = new AbortController();
    controller.abort();
    const cancelled = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] }), {
      findRepository,
    });
    await cancelled.runner.apply(
      { kind: 'config.verify', taskId: 'task-1' },
      createContext(controller.signal)
    );
    expect([...moved.dispatched, ...cancelled.dispatched]).toEqual([]);
    expect(asked).toEqual(['asked']);
  });

  test('a cancelled setup check stops the fetch it runs and records nothing', async () => {
    const { repo } = await createGitRepo();
    const readPid = await useHangingFetch(repo.path);
    const { runner, dispatched } = setup(withTask({ stage: 'triage' }, { ...repo, defaultBranch: 'trunk' }));
    const controller = new AbortController();
    const running = runner.apply(
      { kind: 'config.verify', taskId: 'task-1' },
      createContext(controller.signal)
    );
    await until('the fetch to start', () => readPid() > 0);
    controller.abort();
    await running;
    await until('the fetch to stop', () => !isRunning(readPid()));
    expect(dispatched).toEqual([]);
  });
});

describe('worktrees', () => {
  test('a worktree is made for a triaged task under the effect’s own id, and anything else is skipped', async () => {
    const { repo } = await createGitRepo();
    const { runner, dispatched, commandIds } = setup(withTask({ stage: 'triage', worktreePath: null }, repo));
    const context = createContext();
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, context);
    expect(dispatched[0]).toMatchObject({
      type: 'worktree.ready',
      taskId: 'task-1',
      branch: 'fix/tab-scroll',
    });
    expect(commandIds).toEqual([`${context.key}:worktree.ready`]);
    const skipped = setup(withTask({ stage: 'building' }, repo));
    await skipped.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(skipped.dispatched).toEqual([]);
    const missing = setup();
    await expect(
      missing.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('no longer exists');
  });

  test('a released task resets its untouched worktree; one with work keeps it', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, { 'stray.txt': 'x' });
    const fresh = setup(withTask({ stage: 'triage', worktreePath: worktree }, repo));
    await fresh.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'stray.txt'))).toBe(false);
    expect(fresh.dispatched[0]).toMatchObject({ type: 'worktree.ready', path: worktree });
    writeFiles(worktree, { 'kept.txt': 'x' });
    const worked = setup(
      withTask({ stage: 'triage', worktreePath: worktree, phaseReports: [{}] as Task['phaseReports'] }, repo)
    );
    await worked.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'kept.txt'))).toBe(true);
  });

  test('a later round keeps the worktree’s commits and drops only the scratch edits left in it', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, { 'scratch.txt': 'x' });
    const rounds = [
      createRound({ number: 1, status: 'merged' }),
      createRound({ number: 2, status: 'active', shipping: 'onto_pull_request' }),
    ];
    const { runner, dispatched } = setup(withTask({ stage: 'triage', worktreePath: worktree, rounds }, repo));
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'scratch.txt'))).toBe(false);
    expect(existsSync(join(worktree, 'a.txt'))).toBe(true);
    expect(dispatched[0]).toMatchObject({ type: 'worktree.ready', path: worktree });
  });

  test('a cancelled worktree set-up stops the fetch it runs and reports no worktree', async () => {
    const { repo } = await createGitRepo();
    const readPid = await useHangingFetch(repo.path);
    const { runner, dispatched } = setup(withTask({ stage: 'triage', worktreePath: null }, repo));
    const controller = new AbortController();
    const running = runner.apply(
      { kind: 'worktree.create', taskId: 'task-1' },
      createContext(controller.signal)
    );
    await until('the fetch to start', () => readPid() > 0);
    controller.abort();
    await expect(running).rejects.toThrow('The command was cancelled before it started.');
    await until('the fetch to stop', () => !isRunning(readPid()));
    expect(dispatched).toEqual([]);
  });

  test('removing a worktree removes its delegations’ checkouts too, and a failure there is only logged', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, config, dispatched } = setup(withTask({ worktreePath: worktree }, repo));
    mkdirSync(join(config.worktreesDir, 'delegations'), { recursive: true });
    writeFileSync(join(config.worktreesDir, 'delegations', 'task-1'), 'not a folder');
    const warn = spyOn(log, 'warn');
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(warn).toHaveBeenCalledWith('[Effects] Could not remove the checkouts of delegations', {
      taskId: 'task-1',
      error: expect.stringContaining('ENOTDIR'),
    });
    warn.mockRestore();
    expect(dispatched).toEqual([{ type: 'worktree.gone', taskId: 'task-1' }]);
  });

  test('removing a worktree reports it gone even when git cannot remove it', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, commandIds } = setup(withTask({ worktreePath: worktree }, repo));
    const context = createContext();
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, context);
    expect(existsSync(worktree)).toBe(false);
    expect(commandIds).toEqual([`${context.key}:worktree.gone`]);
    const broken = setup(withTask({ worktreePath: createTempDir() }, { ...repo, path: createTempDir() }));
    await broken.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    const none = setup(withTask({ worktreePath: null }));
    await none.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect([...dispatched, ...broken.dispatched, ...none.dispatched]).toEqual([
      { type: 'worktree.gone', taskId: 'task-1' },
      { type: 'worktree.gone', taskId: 'task-1' },
    ]);
  });
});

describe('scratch folders', () => {
  function writeScratch(dataDir: string) {
    const scratch = resolveScratchPath(dataDir, 'task-1');
    mkdirSync(join(scratch, 'notes'), { recursive: true });
    writeFileSync(join(scratch, 'notes', 'answer.md'), 'x');
    return scratch;
  }

  test('a settled task’s scratch folder is removed once its runs stop, and removing it again is harmless', async () => {
    for (const stage of ['done', 'merged', 'cancelled'] as const) {
      const { runner, config, calls, dispatched } = setup(withTask({ stage, repoId: null }));
      const scratch = writeScratch(config.dataDir);
      await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
      expect(existsSync(scratch)).toBe(false);
      await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
      expect(calls).toEqual(['quiesce:task-1', 'quiesce:task-1']);
      expect(dispatched).toEqual([]);
    }
    const gone = setup();
    await gone.runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(gone.calls).toEqual(['quiesce:task-1']);
  });

  test('a task reopened before or while its runs stop keeps its scratch folder', async () => {
    const reopened = setup(withTask({ stage: 'answering', repoId: null }));
    const kept = writeScratch(reopened.config.dataDir);
    await reopened.runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(existsSync(kept)).toBe(true);
    expect(reopened.calls).toEqual([]);

    const stub = createStubEngine(withTask({ stage: 'done', repoId: null }));
    const config = createTestConfig(createTempDir());
    const scratch = writeScratch(config.dataDir);
    const runs = {
      quiesce: () => {
        stub.update((state) => {
          const task = state.tasks['task-1'];
          if (task) task.stage = 'answering';
        });
        return Promise.resolve();
      },
    } as unknown as RunSupervisor;
    const runner = new EffectRunner(stub.engine, config, runs, createBriefings().briefings, {
      triage: () => Promise.resolve(null),
    });
    await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(existsSync(scratch)).toBe(true);
  });
});

describe('checks', () => {
  test('checks run after the agents stop, only while the task is checking, and record once per effect', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, calls, commandIds } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, checkCommands: ['test -f a.txt'] })
    );
    const context = createContext();
    await runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 }, context);
    expect(calls).toEqual(['quiesce:task-1']);
    expect(dispatched[0]).toMatchObject({ type: 'checks.record', results: [{ outcome: 'pass' }] });
    expect(commandIds).toEqual([`${context.key}:checks.record`]);
    const idle = setup(withTask({ stage: 'building' }, repo));
    await idle.runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 }, createContext());
    expect(idle.dispatched).toEqual([]);
  });

  test("attaches the checks' output as evidence, leaving out output an agent attached this round", async () => {
    const { repo, worktree } = await createShippingRepo();
    const piece = (id: string, overrides: Partial<Evidence>): Evidence => ({
      id,
      taskId: 'task-1',
      runId: 'run-1',
      kind: 'test',
      title: id,
      uri: `/api/evidence/task-1/round-1/${id}.txt`,
      attachedAt: 1,
      ...overrides,
    });
    const { runner, dispatched, config } = setup((state) => {
      withTask(
        { stage: 'checking', worktreePath: worktree },
        { ...repo, checkCommands: ['echo 4 pass', 'echo clean'] }
      )(state);
      for (const item of [
        piece('agent-tests', {}),
        piece('shinsa-earlier', { runId: null, kind: 'check' }),
        piece('shot', { kind: 'screenshot' }),
        piece('preview', { kind: 'note', uri: 'https://example.com/out.txt' }),
        piece('later-round', { round: 2 }),
        piece('other-task', { taskId: 'task-2' }),
      ])
        state.evidence[item.id] = item;
    });
    const folder = join(config.evidenceDir, 'task-1', 'round-1');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'agent-tests.txt'), '$ bun test\n4 pass [12.00ms]');
    for (const name of ['shinsa-earlier', 'shot', 'later-round', 'other-task'])
      writeFileSync(join(folder, `${name}.txt`), 'clean');
    await runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 }, createContext());
    const uri = (dispatched[0] as { evidence: { uri: string } }).evidence.uri;
    expect(readFileSync(join(config.evidenceDir, uri.slice('/api/evidence/'.length)), 'utf8')).toBe(
      '$ echo clean\nPassed.\nclean'
    );
    expect(dispatched[0]).toMatchObject({
      type: 'checks.record',
      evidence: {
        title: 'Checks run by Shinsa: 1 passed',
        detail: expect.stringContaining('Left out echo 4 pass'),
        uri: expect.stringMatching(
          /^\/api\/evidence\/task-1\/round-1\/checks-run-by-shinsa-1-passed-\w+\.txt$/
        ),
      },
    });
  });

  test('attaches nothing when an agent attached the output of every check', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, config } = setup((state) => {
      withTask(
        { stage: 'checking', worktreePath: worktree },
        { ...repo, checkCommands: ['echo clean'] }
      )(state);
      state.evidence.lint = {
        id: 'lint',
        taskId: 'task-1',
        runId: 'run-1',
        kind: 'check',
        title: 'Lint',
        uri: '/api/evidence/task-1/round-1/lint.txt',
        attachedAt: 1,
      };
    });
    mkdirSync(join(config.evidenceDir, 'task-1', 'round-1'), { recursive: true });
    writeFileSync(join(config.evidenceDir, 'task-1', 'round-1', 'lint.txt'), 'clean');
    await runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 }, createContext());
    expect(dispatched[0]).not.toHaveProperty('evidence');
  });

  test("the plan's checks run after the repository's own, the same way, each named by its command", async () => {
    const { repo, worktree } = await createShippingRepo();
    const document: PlanDocument = {
      goal: 'Add the file.',
      phases: [],
      behaviour: [],
      approach: 'Write it.',
      files: [],
      outOfScope: [],
      verification: ['The checks pass.'],
      questions: [],
      checks: ['test -f missing.txt'],
    };
    const { runner, dispatched } = setup(
      withTask(
        {
          stage: 'checking',
          worktreePath: worktree,
          plan: { version: 1, body: '', document, proposedAt: 1 },
        },
        { ...repo, checkCommands: ['test -f a.txt'] }
      )
    );
    await runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 }, createContext());
    expect(dispatched[0]).toMatchObject({
      type: 'checks.record',
      results: [
        { name: 'test -f a.txt', outcome: 'pass' },
        { name: 'test -f missing.txt', outcome: 'fail' },
      ],
    });
  });

  test('cancelled checks stop the running command, skip the rest and record nothing', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched } = setup(
      withTask(
        { stage: 'checking', worktreePath: worktree },
        { ...repo, checkCommands: ['touch started && sleep 30', 'touch second'] }
      )
    );
    const controller = new AbortController();
    const running = runner.apply(
      { kind: 'checks.run', taskId: 'task-1', round: 1 },
      createContext(controller.signal)
    );
    await until('the first check to start', () => existsSync(join(worktree, 'started')));
    controller.abort();
    await running;
    expect(existsSync(join(worktree, 'second'))).toBe(false);
    expect(dispatched).toEqual([]);
  });
});

describe('pull requests', () => {
  test('opening pushes, records the pull request with its comments and syncs it again once CI starts', async () => {
    const readGitHub = useFakeGitHub();
    const { repo, worktree, origin } = await createShippingRepo();
    const { runner, dispatched, commandIds } = setup(
      withTask({ stage: 'shipping', worktreePath: worktree }, repo),
      { config: { settleDelayMs: 10 } }
    );
    const context = createContext();
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, context);
    const head = await git(worktree, 'rev-parse', 'HEAD');
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(head);
    expect(dispatched.map((command) => command.type)).toEqual([
      'pull_request.record_push',
      'pull_request.record',
    ]);
    expect(commandIds[0]).toBe(`${context.key}:pull_request.record_push:${head}`);
    expect(dispatched[1]).toMatchObject({ remarks: [], viewer: 'shinsa-user' });
    await until('the follow-up sync', () => dispatched.length === 3);
    expect(readGitHub().pulls).toHaveLength(1);
    await runner.stop();
  });

  test('pushing without a pull request opens one; with one it pushes and syncs later', async () => {
    useFakeGitHub();
    const { repo, worktree } = await createShippingRepo();
    const first = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo));
    await first.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    expect(first.dispatched.map((command) => command.type)).toEqual([
      'pull_request.record_push',
      'pull_request.record',
    ]);
    await first.runner.stop();
    const second = setup(withTask({ stage: 'shipping', worktreePath: worktree, pullRequest: PULL }, repo));
    await second.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    expect(second.dispatched.map((command) => command.type)).toEqual(['pull_request.record_push']);
    await second.runner.stop();
  });

  test('an open or a push cancelled before it pushes pushes nothing and opens nothing', async () => {
    const readGitHub = useFakeGitHub();
    const { repo, worktree, origin } = await createShippingRepo();
    const controller = new AbortController();
    controller.abort();
    for (const kind of ['pull_request.open', 'pull_request.push'] as const) {
      const { runner, dispatched } = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo));
      await runner.apply({ kind, taskId: 'task-1' }, createContext(controller.signal));
      expect(dispatched).toEqual([]);
    }
    await expect(
      git(origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/fix/tab-scroll')
    ).rejects.toThrow();
    expect(readGitHub().calls).toEqual([]);
  });

  test('without a worktree, or when GitHub returns nothing, opening fails', async () => {
    const { repo } = await createGitRepo();
    for (const kind of ['pull_request.open', 'pull_request.push'] as const) {
      const { runner } = setup(withTask({ worktreePath: null }, repo));
      await expect(runner.apply({ kind, taskId: 'task-1' }, createContext())).rejects.toThrow(
        'The task has no worktree.'
      );
    }
    useFakeGitHub();
    useFailingGh('pr create', 0);
    const shipping = await createShippingRepo();
    const { runner } = setup(withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo));
    await expect(
      runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('GitHub did not return');
  });

  test('merging uses the merge method from settings and needs a pull request', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(
      withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo)
    );
    update((state) => {
      state.settings = { ...state.settings, mergeMethod: 'rebase' };
    });
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(readGitHub().pulls[0]).toMatchObject({ state: 'MERGED', mergedWith: '--rebase' });
    expect(dispatched[0]).toMatchObject({ type: 'pull_request.record', pullRequest: { state: 'merged' } });
    const none = setup(withTask({ pullRequest: null }, repo));
    await expect(
      none.runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('no pull request to merge');
  });

  test('a merge that already went through before a crash is recorded, not attempted again', async () => {
    const readGitHub = useFakeGitHub([
      fakePull('fix/tab-scroll', { state: 'MERGED', mergedWith: '--squash' }),
    ]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(readGitHub().calls.some((call) => call[0] === 'pr' && call[1] === 'merge')).toBe(false);
    expect(dispatched[0]).toMatchObject({ type: 'pull_request.record', pullRequest: { state: 'merged' } });
  });

  test('a merge GitHub reports as done while the pull request stays open fails, so it is retried', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    useFailingGh('pr merge', 0);
    const { repo } = await createGitRepo();
    const { runner } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await expect(
      runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('GitHub still shows the pull request as open after merging it.');
  });

  test('a pull request GitHub puts in its merge queue is waiting, not a failed merge, and is never queued twice', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')], { mergeQueue: true });
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(records(dispatched).at(-1)?.pullRequest).toMatchObject({
      state: 'open',
      mergeQueue: { state: 'queued', position: 1 },
    });
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(readGitHub().calls.filter((call) => call[0] === 'pr' && call[1] === 'merge')).toHaveLength(1);
  });

  test('a merge cancelled before it reaches GitHub never merges', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    const controller = new AbortController();
    controller.abort();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext(controller.signal));
    expect(readGitHub().calls.some((call) => call[1] === 'merge')).toBe(false);
    expect(dispatched).toEqual([]);
  });
});

describe('merging a stack of pull requests', () => {
  const STACK = [
    createRound({
      number: 1,
      branch: 'feat/one',
      pullRequest: { number: 7, url: 'https://github.com/acme/app/pull/7', state: 'open', base: 'main' },
    }),
    createRound({
      number: 2,
      branch: 'feat/two',
      base: 'feat/one',
      pullRequest: { number: 8, url: 'https://github.com/acme/app/pull/8', state: 'open', base: 'feat/one' },
    }),
    createRound({ number: 3, status: 'active', branch: 'feat/three', base: 'feat/two' }),
  ];

  function stackedPulls(overrides: Record<number, Record<string, unknown>> = {}) {
    return [
      fakePull('feat/one', { number: 7, ...overrides[7] }),
      fakePull('feat/two', { number: 8, base: 'feat/one', ...overrides[8] }),
      fakePull('feat/three', { number: 9, base: 'feat/two', ...overrides[9] }),
    ];
  }

  function listMerged(calls: string[][]) {
    return calls.filter((call) => call[0] === 'pr' && call[1] === 'merge').map((call) => call[2]);
  }

  async function setupStack() {
    const { repo } = await createGitRepo();
    return setup(
      withTask({ stage: 'awaiting_merge', pullRequest: { ...PULL, number: 9 }, rounds: STACK }, repo)
    );
  }

  test('merges the task’s pull request, then each one below it top down, skipping one already merged', async () => {
    const readGitHub = useFakeGitHub(stackedPulls({ 8: { state: 'MERGED' } }));
    const { runner } = await setupStack();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(listMerged(readGitHub().calls)).toEqual(['9', '7']);
    expect(readGitHub().pulls.map((pull) => pull.state)).toEqual(['MERGED', 'MERGED', 'MERGED']);
  });

  test('a pull request below that GitHub leaves open after merging it fails the merge, so it is retried', async () => {
    useFakeGitHub(stackedPulls());
    useFailingGh('pr merge 7', 0);
    const { runner } = await setupStack();
    await expect(
      runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('GitHub still shows pull request #7 below this one as open after merging it.');
  });

  test('pull requests below that GitHub puts in its merge queue are waiting, and are never queued twice', async () => {
    const readGitHub = useFakeGitHub(stackedPulls(), { mergeQueue: true });
    const { runner } = await setupStack();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext());
    expect(listMerged(readGitHub().calls)).toEqual(['9', '8', '7']);
  });

  test('a cancel between two merges merges nothing more', async () => {
    const readGitHub = useFakeGitHub(stackedPulls());
    const { runner } = await setupStack();
    const controller = new AbortController();
    const merge = github.mergePullRequest;
    const spy = spyOn(github, 'mergePullRequest').mockImplementation(async (...args) => {
      await merge(...args);
      controller.abort();
    });
    try {
      await expect(
        runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' }, createContext(controller.signal))
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(readGitHub().pulls.map((pull) => pull.state)).toEqual(['OPEN', 'OPEN', 'MERGED']);
  });
});

describe('syncing a pull request', () => {
  test('a sync retargets a stale base, a watch effect always records, and unknown tasks are ignored', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', pullRequest: { ...PULL, base: 'feat/old' } }, repo)
    );
    await runner.syncPullRequest('task-1');
    expect(readGitHub().pulls[0]).toMatchObject({ base: 'main' });
    await runner.apply({ kind: 'pull_request.watch', taskId: 'task-1' }, createContext());
    expect(await runner.syncPullRequest('missing')).toBeNull();
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record', 'pull_request.record']);
  });

  test('a sync records only news: a changed pull request, a new comment, or a watch that would move', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    await runner.syncPullRequest('task-1');
    const [first] = records(dispatched);
    update((state) => {
      const task = state.tasks['task-1'];
      if (!task || !first) return;
      const watch = evaluatePullRequestWatch(
        createPullRequestWatch(1),
        first.pullRequest,
        first.remarks ?? null,
        first.viewer ?? null
      ).next;
      state.tasks['task-1'] = { ...task, pullRequest: first.pullRequest, pullRequestWatch: watch };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(1);
    readGitHub.change((state) => {
      state.pulls[0] = {
        ...state.pulls[0],
        comments: [{ id: 'c1', author: 'bot', createdAt: '2026-02-01T00:00:00Z', body: 'Nit' }],
      };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(2);
    expect(records(dispatched)[1]?.remarks?.map((remark) => remark.id)).toEqual(['c1']);
  });

  test('a branch with no pull request yet records nothing', async () => {
    useFakeGitHub([fakePull('nothing-matches', { number: 9 })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: null }, repo));
    expect(await runner.syncPullRequest('task-1')).toBeNull();
    expect(dispatched).toEqual([]);
  });

  test('each failed read is reported to the log; a good read after failures is recorded so the count starts again', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')], { failReads: 2 });
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const failed = () =>
      dispatched.flatMap((command) => (command.type === 'pull_request.read_failed' ? [command] : []));
    await runner.syncPullRequest('task-1');
    await runner.syncPullRequest('task-1');
    expect(failed()).toEqual([
      {
        type: 'pull_request.read_failed',
        taskId: 'task-1',
        detail: 'gh pr view failed: HTTP 502: Bad Gateway',
      },
      {
        type: 'pull_request.read_failed',
        taskId: 'task-1',
        detail: 'gh pr view failed: HTTP 502: Bad Gateway',
      },
    ]);
    await runner.syncPullRequest('task-1');
    const [first] = records(dispatched);
    update((state) => {
      const task = state.tasks['task-1'];
      if (!task || !first) return;
      const watch = evaluatePullRequestWatch(
        createPullRequestWatch(1),
        first.pullRequest,
        first.remarks ?? null,
        first.viewer ?? null
      ).next;
      state.tasks['task-1'] = { ...task, pullRequest: first.pullRequest, pullRequestWatch: watch };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(1);
    update((state) => {
      const task = state.tasks['task-1'];
      if (task) state.tasks['task-1'] = { ...task, pullRequestReadFailures: 3 };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(2);
    expect(readGitHub().failReads).toBe(0);
  });

  test('a read GitHub refuses for its rate limit is not counted toward giving up', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    useFailingGh('pr view', 1, 'API rate limit exceeded for user ID 1.');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    for (let read = 0; read < 3; read += 1) await runner.syncPullRequest('task-1');
    expect(dispatched).toEqual([]);
  });

  test('a retarget GitHub refuses counts as a failed read', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    useFailingGh('pr edit');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', pullRequest: { ...PULL, base: 'feat/old' } }, repo)
    );
    expect(await runner.syncPullRequest('task-1')).toBeNull();
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.read_failed']);
  });
});

describe('watching pull requests', () => {
  test('every shipping task with a live watch is synced on an interval, one sync at a time, until stopped', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      (state) => {
        withTask({ stage: 'awaiting_merge' }, repo)(state);
        state.tasks.idle = createTask({ id: 'idle', stage: 'building' });
        state.tasks.stopped = createTask({
          id: 'stopped',
          stage: 'shipping',
          pullRequestWatch: { ...createPullRequestWatch(1), stopped: 'comment_limit' },
        });
      },
      { watchIntervalMs: 20 }
    );
    await Promise.all([runner.recover(), runner.syncAll()]);
    expect(readGitHub().calls.filter((call) => call[1] === 'view')).toHaveLength(1);
    runner.startWatching();
    runner.startWatching();
    await until('a watched sync', () => dispatched.length >= 2);
    await runner.stop();
    await runner.stop();
  });

  test('stopping aborts the sync in flight and waits for it, so no gh outlives the runner', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    const readPid = useHangingGh('pr view');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const sync = runner.syncAll();
    await until('the read to start', () => readPid() > 0);
    await runner.stop();
    await sync;
    expect(isRunning(readPid())).toBe(false);
    expect(dispatched).toEqual([]);
  });

  test('syncs of one task run one after another, so an older read is never recorded over a newer one', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { checks: 'pending' })]);
    const release = useHeldGh('api graphql');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const spawn = spyOn(Bun, 'spawn');
    restores.push(() => spawn.mockRestore());
    const older = runner.syncPullRequest('task-1');
    await until('the older read', () => readGitHub().calls.some((call) => call[1] === 'graphql'));
    readGitHub.change((state) => {
      state.pulls[0] = { ...state.pulls[0], checks: 'passing' };
    });
    const spawned = spawn.mock.calls.length;
    const newer = runner.syncPullRequest('task-1');
    if (spawn.mock.calls.length > spawned) {
      await until('the newer read to be recorded', () => records(dispatched).length === 1);
    }
    release();
    await Promise.all([older, newer]);
    expect(records(dispatched).map((record) => record.pullRequest.checks)).toEqual(['pending', 'passing']);
  });

  test('a sync that fails in the background is logged, not thrown', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo, worktree } = await createShippingRepo();
    const warn = spyOn(log, 'warn');
    restores.push(() => warn.mockRestore());
    const { runner, reject } = setup(
      withTask({ stage: 'shipping', worktreePath: worktree, pullRequest: PULL }, repo),
      { watchIntervalMs: 10, config: { settleDelayMs: 5 } }
    );
    reject((command) => command.type === 'pull_request.record', new Error('engine stopped'));
    runner.startWatching();
    await runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    const failed = (taskId?: string) =>
      warn.mock.calls.some(
        ([message, fields]) =>
          message === '[Watch] Pull request sync failed' &&
          (fields as { taskId?: string } | undefined)?.taskId === taskId
      );
    await until('the follow-up sync to fail', () => failed('task-1'));
    await until('the interval sync to fail', () => failed(undefined));
    await runner.stop();
  });
});
