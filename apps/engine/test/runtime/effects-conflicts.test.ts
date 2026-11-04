import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, ShinsaState, Task } from '@shinsa/core';
import { Effect } from 'effect';
import type { RunSupervisor } from '../../src/agents/supervisor/service.ts';
import { BriefingWriter } from '../../src/briefing/service.ts';
import { EffectRunner } from '../helpers/effects.ts';
import {
  captureLogs,
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  NO_HANDOFFS,
  NO_PREVIEWS,
  NO_SHARES,
  overrideEnv,
  writeFiles,
} from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';

const RUNS = { quiesce: () => Effect.void } as unknown as RunSupervisor['Service'];

const BRIEFINGS = BriefingWriter.of({ schedule: Effect.void, stop: Effect.void });

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

let effects = 0;

function _createContext() {
  effects += 1;
  return { key: `conflict-effect-${effects}`, attempt: 1, signal: new AbortController().signal };
}

function setup(tasks: Partial<Task>[], repo: Partial<Repo>) {
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    for (const task of tasks) state.tasks[task.id ?? 'task-1'] = createTask(task);
  });
  const runner = new EffectRunner(stub.engine, createTestConfig(createTempDir()), RUNS, BRIEFINGS, {
    shares: NO_SHARES,
    previews: NO_PREVIEWS,
    handoffs: NO_HANDOFFS,
    resolveLogin: () => Promise.resolve(null),
    triage: () => Effect.succeed(null),
  });
  return { ...stub, runner };
}

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
    const logs = captureLogs();
    for (const base of ['gone', '-x']) {
      writeConflictingPull(base);
      const { runner, dispatched } = setup([{ stage: 'shipping', pullRequest: null }], repo);
      await runner.syncPullRequest('task-1');
      expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record']);
    }
    logs.restore();
    expect(
      logs
        .fieldsOf('[Watch] Could not fetch the base of a conflicting pull request; the agent fetches it')
        .map((fields) => fields.base)
    ).toEqual(['gone', '-x']);
  });
});
