import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, ShinsaState, Task } from '@shinsa/core';
import type { RunSupervisor } from '../../src/agents/index.ts';
import type { Briefings } from '../../src/briefing/index.ts';
import { log } from '../../src/log/index.ts';
import { EffectRunner } from '../../src/runtime/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  NO_SHARES,
  overrideEnv,
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
    resolveLogin: () => Promise.resolve(null),
    triage: () => Promise.resolve(null),
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
