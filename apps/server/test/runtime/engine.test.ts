import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, ShinsaEffect } from '@shinsa/core';
import { Engine, MAX_EFFECT_ATTEMPTS, resolveBackoff } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { until } from '../helpers/index.ts';

const dirs: string[] = [];

function createDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-engine-'));
  dirs.push(dir);
  return join(dir, 'shinsa.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REPO: Omit<Repo, 'id' | 'areaId'> = {
  name: 'app',
  path: '/code/app',
  defaultBranch: 'main',
  remote: null,
  checkCommands: [],
  previewCommand: null,
};

async function seedTask(engine: Engine) {
  await engine.dispatch({ type: 'repo.register', repo: REPO, areaName: null });
  await engine.dispatch({ type: 'task.create', intent: 'Fix the tab scroll', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  return { taskId, repoId };
}

async function startPlanning(engine: Engine) {
  const { taskId, repoId } = await seedTask(engine);
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix',
    repoId,
    size: 'small',
    branch: 'fix/a',
    dependsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: '/wt/a', branch: 'fix/a' });
  return taskId;
}

describe('engine', () => {
  test('commands persist as events and replay into the same state', async () => {
    const path = createDatabasePath();
    const log = new EventLog(path);
    const engine = new Engine(log);
    const effects: ShinsaEffect[] = [];
    engine.onEffect((effect) => {
      effects.push(effect);
      return Promise.resolve();
    });
    engine.start();

    await engine.dispatch({ type: 'area.write', area: { name: 'Superwall', color: 'blue' } });
    await engine.dispatch({ type: 'task.create', intent: 'Fix the tab scroll', repoId: null });
    await engine.drain();

    expect(Object.values(engine.state.tasks).map((task) => task.stage)).toEqual(['triage']);
    expect(effects.map((effect) => effect.kind)).toContain('task.triage');
    engine.stop();
    log.close();

    const replayed = new Engine(new EventLog(path));
    expect(replayed.state.seq).toBe(engine.state.seq);
    expect(replayed.state.tasks).toEqual(engine.state.tasks);
  });

  test('a rejected command leaves no events and keeps the queue moving', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const before = engine.state.seq;
    await expect(engine.dispatch({ type: 'task.create', intent: '   ', repoId: null })).rejects.toThrow(
      'Describe what you want done.'
    );
    expect(engine.state.seq).toBe(before);
    await engine.dispatch({ type: 'area.write', area: { name: 'Next', color: 'blue' } });
    expect(engine.state.seq).toBe(before + 1);
  });

  test('a throwing listener cannot drop the effects of a committed command', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const seen: string[] = [];
    engine.subscribe(() => {
      throw new Error('listener broke');
    });
    engine.onEffect((effect) => {
      seen.push(effect.kind);
      return Promise.resolve();
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
    await engine.drain();
    expect(seen).toContain('task.triage');
    engine.stop();
  });
});

describe('effect outbox', () => {
  test('a failing effect is retried with backoff and settles once it succeeds', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    let attempts = 0;
    engine.onEffect((effect) => {
      if (effect.kind !== 'task.triage') return Promise.resolve();
      attempts += 1;
      return attempts < 3 ? Promise.reject(new Error('git is busy')) : Promise.resolve();
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
    for (let wait = 0; wait < 40 && attempts < 3; wait += 1) await Bun.sleep(50);
    await engine.drain();
    expect(attempts).toBe(3);
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toEqual({
      kind: 'task.triage',
      status: 'done',
      attempts: 3,
    });
    engine.stop();
  });

  test('backoff doubles from 100ms and is capped at 30s', () => {
    expect([1, 2, 3, 4].map(resolveBackoff)).toEqual([100, 200, 400, 800]);
    expect(resolveBackoff(20)).toBe(30_000);
  });

  test('a process-bound effect that fails is not retried and opens a failure gate', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    let calls = 0;
    engine.onEffect((effect) => {
      if (effect.kind !== 'run.execute') return Promise.resolve();
      calls += 1;
      return Promise.reject(new Error('no claude'));
    });
    engine.onEffectExhausted(async (effect, error) => {
      if (effect.kind !== 'run.execute') return;
      const run = engine.state.runs[effect.runId];
      if (run) {
        await engine.dispatch({
          type: 'effect.fail',
          taskId: run.taskId,
          title: 'Could not start',
          detail: error,
        });
      }
    });
    engine.start();
    const taskId = await startPlanning(engine);
    await engine.drain();
    const gate = Object.values(engine.state.gates).find((candidate) => candidate.taskId === taskId);
    expect(calls).toBe(1);
    expect(gate?.purpose).toBe('failure');
    expect(gate?.body).toBe('no claude');
    expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('failed');
    engine.stop();
  });

  test('a cancel is not stuck behind the long-running session it cancels', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const cancelled: string[] = [];
    engine.onEffect((effect) => {
      if (effect.kind === 'run.execute') return new Promise<void>(() => undefined);
      if (effect.kind === 'run.cancel') cancelled.push(effect.runId);
      return Promise.resolve();
    });
    engine.start();
    const taskId = await startPlanning(engine);
    const runId = Object.values(engine.state.runs)[0]?.id ?? '';
    await engine.dispatch({ type: 'task.cancel', taskId });
    for (let wait = 0; wait < 20 && cancelled.length === 0; wait += 1) await Bun.sleep(10);
    expect(cancelled).toEqual([runId]);
    engine.stop();
  });

  test('after a restart, work for dead processes is dropped and the rest runs again', async () => {
    const path = createDatabasePath();
    const first = new Engine(new EventLog(path));
    first.onEffect(() => new Promise<void>(() => undefined));
    first.start();
    await startPlanning(first);
    await Bun.sleep(10);
    first.stop();

    const log = new EventLog(path);
    const second = new Engine(log);
    const replayed: string[] = [];
    second.onEffect((effect) => {
      replayed.push(effect.kind);
      return Promise.resolve();
    });
    second.start();
    await second.drain();
    expect(replayed).toContain('task.triage');
    expect(replayed).not.toContain('run.execute');
    expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('cancelled');
    second.stop();
  });
});

describe('engine lifecycle', () => {
  test('dispatch reports the events it committed, and nothing for a no-op', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const events = await engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
    expect(events.map((event) => event.type)).toContain('task.created');
  });

  test('an unsubscribed listener hears nothing more', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });
    await engine.dispatch({ type: 'area.write', area: { name: 'One', color: 'blue' } });
    unsubscribe();
    await engine.dispatch({ type: 'area.write', area: { name: 'Two', color: 'blue' } });
    expect(calls).toBe(1);
  });

  test('once stopped it takes no commands and leaves running effects unrecorded', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    const release = Promise.withResolvers<void>();
    const fail = Promise.withResolvers<void>();
    let calls = 0;
    engine.onEffect(() => {
      calls += 1;
      return calls === 1 ? release.promise : fail.promise;
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', intent: 'One', repoId: null });
    await engine.dispatch({ type: 'task.create', intent: 'Another', repoId: null });
    await until('both effects', () => calls === 2);
    engine.stop();
    release.resolve();
    fail.reject(new Error('late'));
    await engine.settle();
    await engine.idle();
    expect(engine.dispatch({ type: 'task.create', intent: 'Late', repoId: null })).rejects.toThrow(
      'shutting down'
    );
    expect(
      log.listEffectStatuses().every((row) => row.status === 'running' || row.status === 'pending')
    ).toBe(true);
  });

  test('an effect that keeps failing ends after five attempts, and a broken report is only logged', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    engine.onEffect((effect) =>
      effect.kind === 'task.triage' ? Promise.reject(new Error('always')) : Promise.resolve()
    );
    engine.onEffectExhausted(() => Promise.reject(new Error('report broke')));
    engine.start();
    await engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
    for (let wait = 0; wait < 100; wait += 1) {
      if (log.listEffectStatuses().some((row) => row.status === 'failed')) break;
      await Bun.sleep(50);
    }
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toEqual({
      kind: 'task.triage',
      status: 'failed',
      attempts: MAX_EFFECT_ATTEMPTS,
    });
    engine.stop();
  });
});

test('without handlers, effects settle and a failure is only recorded', async () => {
  const log = new EventLog(createDatabasePath());
  const engine = new Engine(log);
  engine.start();
  await engine.dispatch({ type: 'task.create', intent: 'Do it', repoId: null });
  await engine.drain();
  expect(log.listEffectStatuses().map((row) => row.status)).toEqual(['done']);
  engine.onEffect(() => Promise.reject(new Error('gone')));
  await startPlanning(engine);
  await engine.drain();
  expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('failed');
  engine.stop();
});
