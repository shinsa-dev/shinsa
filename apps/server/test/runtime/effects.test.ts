import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PullRequest, ShinsaState, Task } from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { createWorktree } from '../../src/git/index.ts';
import {
  EffectRunner,
  type EffectRunnerOptions,
  Engine,
  isSamePullRequest,
} from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
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
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function useFakeGitHub(pulls: unknown[] = []) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: pulls.length + 1, defaultChecks: 'passing', pulls, calls: [] }));
  restores.push(overrideEnv({ FAKE_GH_STATE: path }));
  return () =>
    JSON.parse(readFileSync(path, 'utf8')) as { pulls: Record<string, unknown>[]; calls: string[][] };
}

function useFailingGh(failing: string) {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${failing}"*) echo "gh is down" >&2; exit 1;; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
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
    steer: (runId: string, text: string) => {
      calls.push(`steer:${runId}:${text}`);
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
  options: EffectRunnerOptions & { config?: Partial<ServerConfig> } = {}
) {
  const stub = createStubEngine(patch);
  const config = createTestConfig(createTempDir(), options.config);
  const { runs, calls } = createRuns();
  const briefings = createBriefings();
  const runner = new EffectRunner(stub.engine, config, runs, briefings.briefings, {
    resolveLogin: () => Promise.resolve(null),
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

async function createShippingRepo(): Promise<TestRepo & { worktree: string }> {
  const repo = await createGitRepo();
  const worktree = await createWorktree(repo.repo, createTempDir(), 'task-1', 'fix/tab-scroll', null);
  writeFiles(worktree.path, { 'a.txt': 'a' });
  await git(worktree.path, 'add', '-A');
  await git(worktree.path, 'commit', '-q', '-m', 'fix: a');
  return { ...repo, worktree: worktree.path };
}

describe('isSamePullRequest', () => {
  test('compares everything that matters to the task, and nothing before means changed', () => {
    expect(isSamePullRequest(null, PULL)).toBe(false);
    expect(isSamePullRequest(PULL, { ...PULL, updatedAt: 9 })).toBe(true);
    expect(isSamePullRequest(PULL, { ...PULL, checks: 'failing' })).toBe(false);
  });
});

describe('routing effects', () => {
  test('run effects go to the supervisor and a briefing request to the briefings', async () => {
    const { runner, calls, scheduled } = setup();
    await runner.apply({ kind: 'run.execute', runId: 'r1' });
    await runner.apply({ kind: 'run.cancel', runId: 'r1' });
    await runner.apply({ kind: 'run.steer', runId: 'r1', text: 'hi' });
    await runner.apply({ kind: 'question.resolve', gateId: 'g1' });
    await runner.apply({ kind: 'briefing.request', areaId: null });
    expect(calls).toEqual(['execute:r1', 'cancel:r1', 'steer:r1:hi', 'question:g1']);
    expect(scheduled()).toBe(1);
  });

  test('an effect that failed for good opens a failure gate on its task, if it has one', async () => {
    const { runner, dispatched } = setup();
    await runner.reportExhausted({ kind: 'pull_request.push', taskId: 't1' }, 'push rejected');
    await runner.reportExhausted({ kind: 'run.execute', runId: 'r1' }, 'x');
    await runner.reportExhausted({ kind: 'pull_request.watch', taskId: 't1' }, 'x');
    expect(dispatched).toEqual([
      { type: 'effect.fail', taskId: 't1', title: 'Could not push the fixes', detail: 'push rejected' },
    ]);
  });
});

describe('triage', () => {
  test('a settled, unknown or already triaged task is left alone', async () => {
    const { runner, dispatched } = setup((state) => {
      state.tasks.done = createTask({ id: 'done', stage: 'cancelled', branch: null });
      state.tasks.triaged = createTask({ id: 'triaged' });
    });
    for (const taskId of ['done', 'triaged', 'missing']) await runner.apply({ kind: 'task.triage', taskId });
    expect(dispatched).toEqual([]);
  });

  test('no repository at all is an error that says where Shinsa looked', async () => {
    const { runner } = setup(withTask({ branch: null, stage: 'triage', repoId: null }), {
      config: { roots: [createTempDir()] },
      triage: () => Promise.resolve(null),
    });
    expect(runner.apply({ kind: 'task.triage', taskId: 'task-1' })).rejects.toThrow(
      'found no git repositories'
    );
  });

  test('the repository is registered and the task triaged with its dependencies', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const engine = new Engine(new EventLog(config.databasePath));
    await engine.dispatch({ type: 'task.create', intent: 'Earlier work', repoId: null });
    await engine.dispatch({ type: 'task.create', intent: 'Fix the button', repoId: null });
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
          dependsOn: dependency ? [dependency] : [],
        }),
    });
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' });
    const triaged = engine.state.tasks[task?.id ?? ''];
    expect(triaged).toMatchObject({
      title: 'Fix the button',
      branch: 'fix/button',
      blockedBy: [dependency?.id],
    });
    expect(Object.values(engine.state.repos).map((repo) => repo.name)).toEqual(['app']);
  });
});

describe('worktrees', () => {
  test('a worktree is made for a triaged task, and anything else is skipped', async () => {
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'triage', worktreePath: null }, repo));
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' });
    expect(dispatched[0]).toMatchObject({
      type: 'worktree.ready',
      taskId: 'task-1',
      branch: 'fix/tab-scroll',
    });
    const skipped = setup(withTask({ stage: 'building' }, repo));
    await skipped.runner.apply({ kind: 'worktree.create', taskId: 'task-1' });
    expect(skipped.dispatched).toEqual([]);
    const missing = setup();
    expect(missing.runner.apply({ kind: 'worktree.create', taskId: 'task-1' })).rejects.toThrow(
      'no longer exists'
    );
  });

  test('a released task resets its untouched worktree; one with work keeps it', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, { 'stray.txt': 'x' });
    const fresh = setup(withTask({ stage: 'triage', worktreePath: worktree }, repo));
    await fresh.runner.apply({ kind: 'worktree.create', taskId: 'task-1' });
    expect(existsSync(join(worktree, 'stray.txt'))).toBe(false);
    expect(fresh.dispatched[0]).toMatchObject({ type: 'worktree.ready', path: worktree });
    writeFiles(worktree, { 'kept.txt': 'x' });
    const worked = setup(
      withTask({ stage: 'triage', worktreePath: worktree, phaseReports: [{}] as Task['phaseReports'] }, repo)
    );
    await worked.runner.apply({ kind: 'worktree.create', taskId: 'task-1' });
    expect(existsSync(join(worktree, 'kept.txt'))).toBe(true);
  });

  test('removing a worktree reports it gone even when git cannot remove it', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched } = setup(withTask({ worktreePath: worktree }, repo));
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' });
    expect(existsSync(worktree)).toBe(false);
    const broken = setup(withTask({ worktreePath: createTempDir() }, { ...repo, path: createTempDir() }));
    await broken.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' });
    const none = setup(withTask({ worktreePath: null }));
    await none.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' });
    expect([...dispatched, ...broken.dispatched, ...none.dispatched]).toEqual([
      { type: 'worktree.gone', taskId: 'task-1' },
      { type: 'worktree.gone', taskId: 'task-1' },
    ]);
  });
});

describe('checks', () => {
  test('checks run after the agents stop, only while the task is checking', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, calls } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, checkCommands: ['test -f a.txt'] })
    );
    await runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 });
    expect(calls).toEqual(['quiesce:task-1']);
    expect(dispatched[0]).toMatchObject({ type: 'checks.record', results: [{ outcome: 'pass' }] });
    const idle = setup(withTask({ stage: 'building' }, repo));
    await idle.runner.apply({ kind: 'checks.run', taskId: 'task-1', round: 1 });
    expect(idle.dispatched).toEqual([]);
  });
});

describe('pull requests', () => {
  test('opening pushes, records the pull request and syncs it again once CI starts', async () => {
    const readGitHub = useFakeGitHub();
    const { repo, worktree, origin } = await createShippingRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo), {
      config: { settleDelayMs: 10 },
    });
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' });
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(
      await git(worktree, 'rev-parse', 'HEAD')
    );
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.pushed', 'pull_request.record']);
    await until('the follow-up sync', () => dispatched.length === 3);
    expect(readGitHub().pulls).toHaveLength(1);
    runner.stop();
  });

  test('pushing without a pull request opens one; with one it pushes and syncs later', async () => {
    useFakeGitHub();
    const { repo, worktree } = await createShippingRepo();
    const first = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo));
    await first.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' });
    expect(first.dispatched.map((command) => command.type)).toEqual([
      'pull_request.pushed',
      'pull_request.record',
    ]);
    first.runner.stop();
    const second = setup(withTask({ stage: 'shipping', worktreePath: worktree, pullRequest: PULL }, repo));
    await second.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' });
    expect(second.dispatched.map((command) => command.type)).toEqual(['pull_request.pushed']);
    second.runner.stop();
  });

  test('without a worktree, or when GitHub returns nothing, opening fails', async () => {
    const { repo } = await createGitRepo();
    for (const kind of ['pull_request.open', 'pull_request.push'] as const) {
      const { runner } = setup(withTask({ worktreePath: null }, repo));
      expect(runner.apply({ kind, taskId: 'task-1' })).rejects.toThrow('The task has no worktree.');
    }
    useFakeGitHub();
    useFailingGh('pr view');
    const shipping = await createShippingRepo();
    const { runner } = setup(withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo));
    expect(runner.apply({ kind: 'pull_request.open', taskId: 'task-1' })).rejects.toThrow(
      'GitHub did not return'
    );
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
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' });
    expect(readGitHub().pulls[0]).toMatchObject({ state: 'MERGED', mergedWith: '--rebase' });
    expect(dispatched[0]).toMatchObject({ type: 'pull_request.record', pullRequest: { state: 'merged' } });
    const none = setup(withTask({ pullRequest: null }, repo));
    expect(none.runner.apply({ kind: 'pull_request.merge', taskId: 'task-1' })).rejects.toThrow(
      'no pull request to merge'
    );
  });

  test('a sync records only changes, retargets a stale base and ignores unknown tasks', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', pullRequest: { ...PULL, base: 'feat/old' } }, repo)
    );
    await runner.syncPullRequest('task-1');
    expect(readGitHub().pulls[0]).toMatchObject({ base: 'main' });
    await runner.apply({ kind: 'pull_request.watch', taskId: 'task-1' });
    await runner.syncPullRequest('missing');
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record', 'pull_request.record']);

    const same = setup(withTask({ stage: 'shipping', pullRequest: { ...PULL, headSha: null } }, repo));
    useFakeGitHub([fakePull('nothing-matches')]);
    await same.runner.syncPullRequest('task-1');
    expect(same.dispatched).toEqual([]);
  });

  test('a stacked task targets its base task until that one merges', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner } = setup((state) => {
      withTask({ stage: 'shipping', pullRequest: PULL, baseTaskId: 'base' }, repo)(state);
      state.tasks.base = createTask({ id: 'base', branch: 'feat/base', stage: 'awaiting_merge' });
    });
    await runner.syncPullRequest('task-1');
    expect(readGitHub().pulls[0]).toMatchObject({ base: 'feat/base' });
  });
});

describe('watching pull requests', () => {
  test('every shipping task is synced on an interval, one sync at a time, until stopped', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      (state) => {
        withTask({ stage: 'awaiting_merge' }, repo)(state);
        state.tasks.idle = createTask({ id: 'idle', stage: 'building' });
      },
      { watchIntervalMs: 20 }
    );
    await Promise.all([runner.recover(), runner.syncAll()]);
    expect(readGitHub().calls.filter((call) => call[1] === 'view')).toHaveLength(1);
    runner.startWatching();
    runner.startWatching();
    await until('a watched sync', () => dispatched.length >= 2);
    runner.stop();
    runner.stop();
  });

  test('a sync that fails in the background is logged, not thrown', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    useFailingGh('pr edit');
    const { repo, worktree } = await createShippingRepo();
    const { runner } = setup(
      withTask(
        { stage: 'shipping', worktreePath: worktree, pullRequest: { ...PULL, base: 'feat/old' } },
        repo
      ),
      {
        watchIntervalMs: 10,
        config: { settleDelayMs: 5 },
      }
    );
    runner.startWatching();
    await runner.apply({ kind: 'pull_request.push', taskId: 'task-1' });
    await Bun.sleep(50);
    runner.stop();
  });
});
