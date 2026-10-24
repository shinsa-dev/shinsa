import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError, type Repo, type ShinsaCommand, type ShinsaEffect } from '@shinsa/core';
import { log as logger } from '../../src/log/index.ts';
import { Engine, MAX_EFFECT_ATTEMPTS, resolveBackoff } from '../../src/runtime/engine.ts';
import { type CommandResult, runCommand } from '../../src/shell/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { awaitEffect, until } from '../helpers/index.ts';

const dirs: string[] = [];

function createDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-engine-'));
  dirs.push(dir);
  return join(dir, 'shinsa.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REPO: Omit<Repo, 'id' | 'projectId'> = {
  name: 'app',
  path: '/code/app',
  defaultBranch: 'main',
  remote: null,
  checkCommands: [],
};

async function seedTask(engine: Engine) {
  await engine.dispatch({ type: 'repo.register', repo: REPO, projectName: null });
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId: null });
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
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: '/wt/a', branch: 'fix/a' });
  return taskId;
}

function selectKey(log: EventLog, kind: string) {
  const key = log.listEffectStatuses().find((row) => row.kind === kind)?.key;
  if (!key) throw new Error(`no ${kind} effect`);
  return key;
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

    await engine.dispatch({ type: 'project.write', project: { name: 'Superwall', color: 'blue' } });
    await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId: null });
    await awaitEffect(log, selectKey(log, 'task.triage'));

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
    await expect(engine.dispatch({ type: 'task.create', request: '   ', repoId: null })).rejects.toThrow(
      'Describe what you want done.'
    );
    expect(engine.state.seq).toBe(before);
    await engine.dispatch({ type: 'project.write', project: { name: 'Next', color: 'blue' } });
    expect(engine.state.seq).toBe(before + 1);
  });

  test('a throwing listener cannot drop the effects of a committed command', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    const seen: string[] = [];
    engine.subscribe(() => {
      throw new Error('listener broke');
    });
    engine.onEffect((effect) => {
      seen.push(effect.kind);
      return Promise.resolve();
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await awaitEffect(log, selectKey(log, 'task.triage'));
    expect(seen).toContain('task.triage');
    engine.stop();
  });
});

describe('command receipts', () => {
  test('a command sent twice under one id is applied once, and the repeat answers with the same events', async () => {
    const path = createDatabasePath();
    const engine = new Engine(new EventLog(path));
    const command: ShinsaCommand = { type: 'task.create', request: 'Fix the tab scroll', repoId: null };
    const first = await engine.dispatch(command, { id: 'client:a' });
    const seq = engine.state.seq;
    const again = await engine.dispatch(command, { id: 'client:a' });
    expect(again).toEqual(first);
    expect(engine.state.seq).toBe(seq);
    expect(Object.keys(engine.state.tasks)).toHaveLength(1);
    const restarted = new Engine(new EventLog(path));
    expect(await restarted.dispatch(command, { id: 'client:a' })).toEqual(first);
    expect(restarted.state.seq).toBe(seq);
  });

  test('an id already used for another command is refused, and the command it belongs to is untouched', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    await engine.dispatch({ type: 'focus.change', projectId: null, until: 1 }, { id: 'client:b' });
    const seq = engine.state.seq;
    await expect(
      engine.dispatch({ type: 'task.cancel', taskId: 'task-1' }, { id: 'client:b' })
    ).rejects.toMatchObject({ code: 'command_id_conflict' });
    await expect(
      engine.dispatch({ type: 'focus.change', projectId: null, until: 2 }, { id: 'client:b' })
    ).rejects.toThrow('Command id client:b was already used for focus.change on *.');
    expect(engine.state.seq).toBe(seq);
    expect(engine.state.focus.until).toBe(1);
  });

  test('a refusal is remembered: the same id gets the same answer, even once the command would pass', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    await engine.dispatch({
      type: 'project.write',
      project: { name: 'Superwall', color: 'blue', key: 'SUP' },
    });
    const [first = ''] = Object.keys(engine.state.projects);
    const taken: ShinsaCommand = {
      type: 'project.write',
      project: { name: 'Supply', color: 'green', key: 'SUP' },
    };
    const refusal = await engine.dispatch(taken, { id: 'client:c' }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DomainError);
    await engine.dispatch({ type: 'project.remove', projectId: first });
    const replayed = await engine.dispatch(taken, { id: 'client:c' }).catch((error: unknown) => error);
    expect(replayed).toEqual(refusal);
    expect(Object.values(engine.state.projects)).toEqual([]);
    await engine.dispatch(taken, { id: 'client:d' });
    expect(Object.values(engine.state.projects).map((project) => project.name)).toEqual(['Supply']);
  });

  test('a command that changes nothing still answers its repeat, and an unexpected failure is remembered too', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    expect(await engine.dispatch({ type: 'runs.dispatch' }, { id: 'client:e' })).toEqual([]);
    expect(await engine.dispatch({ type: 'runs.dispatch' }, { id: 'client:e' })).toEqual([]);
    const broken = { type: 'task.create', request: null, repoId: null } as unknown as ShinsaCommand;
    const first = await engine.dispatch(broken, { id: 'client:f' }).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(TypeError);
    await expect(engine.dispatch(broken, { id: 'client:f' })).rejects.toMatchObject({
      code: 'command_failed',
    });
  });
});

describe('a damaged event log', () => {
  test('boots with every event it can replay, reports the rest and keeps numbering after the last row', async () => {
    const path = createDatabasePath();
    const first = new Engine(new EventLog(path));
    const { taskId } = await seedTask(first);
    await first.dispatch({ type: 'focus.change', projectId: null, until: 42 });
    await first.dispatch({ type: 'task.prioritize', taskId, priority: 'high' });
    const db = new Database(path);
    db.run("UPDATE events SET payload = '{\"type\":\"task.cre' WHERE type = 'task.created'");
    const last = db.query<{ seq: number }, []>('SELECT MAX(seq) AS seq FROM events').get()?.seq ?? 0;
    db.run('UPDATE events SET payload = ? WHERE seq = ?', [
      JSON.stringify({ type: 'task.prioritized', taskId: 'gone' }),
      last,
    ]);
    db.close();
    const engine = new Engine(new EventLog(path));
    expect(engine.state.focus.until).toBe(42);
    expect(engine.state.tasks[taskId]).toBeUndefined();
    expect(engine.state.seq).toBe(last);
    expect(engine.problems.map((problem) => problem.kind)).toEqual(['unreadable']);
    await engine.dispatch({ type: 'focus.change', projectId: null, until: 43 });
    expect(engine.state.seq).toBe(last + 1);
    expect(new Engine(new EventLog(path)).state.focus.until).toBe(43);
  });

  test('an event that cannot be applied is skipped and reported, and the ones after it still apply', async () => {
    const path = createDatabasePath();
    const first = new Engine(new EventLog(path));
    await first.dispatch({ type: 'focus.change', projectId: null, until: 1 });
    await first.dispatch({ type: 'focus.change', projectId: null, until: 2 });
    const db = new Database(path);
    db.run(`UPDATE events SET type = 'task.created', payload = '{"type":"task.created"}' WHERE seq = 1`);
    db.close();
    const engine = new Engine(new EventLog(path));
    expect(engine.state.focus.until).toBe(2);
    expect(engine.problems).toEqual([
      expect.objectContaining({ seq: 1, type: 'task.created', kind: 'unappliable' }),
    ]);
  });

  test('problems of both kinds are reported in log order, whichever kind comes first', async () => {
    const path = createDatabasePath();
    const first = new Engine(new EventLog(path));
    for (const value of [1, 2, 3])
      await first.dispatch({ type: 'focus.change', projectId: null, until: value });
    const db = new Database(path);
    db.run(`UPDATE events SET type = 'task.created', payload = '{"type":"task.created"}' WHERE seq = 1`);
    db.run(`UPDATE events SET payload = '{"type":"focus.ch' WHERE seq = 3`);
    db.close();
    const engine = new Engine(new EventLog(path));
    expect(engine.state.focus.until).toBe(2);
    expect(engine.problems.map((problem) => [problem.seq, problem.kind])).toEqual([
      [1, 'unappliable'],
      [3, 'unreadable'],
    ]);
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
    await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await awaitEffect(log, selectKey(log, 'task.triage'));
    expect(attempts).toBe(3);
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toMatchObject({
      status: 'done',
      attempts: 3,
    });
    engine.stop();
  });

  test('a handler that throws instead of rejecting still fails its effect, and the lane goes on', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    let attempts = 0;
    engine.onEffect((effect) => {
      if (effect.kind !== 'task.triage') return Promise.resolve();
      attempts += 1;
      if (attempts === 1) throw new Error('thrown, not rejected');
      return Promise.resolve();
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await awaitEffect(log, selectKey(log, 'task.triage'));
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toMatchObject({
      status: 'done',
      attempts: 2,
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
    const keys: string[] = [];
    engine.onEffect((effect) => {
      if (effect.kind !== 'run.execute') return Promise.resolve();
      calls += 1;
      return Promise.reject(new Error('no claude'));
    });
    engine.onEffectExhausted(async (effect, error, key) => {
      keys.push(key);
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
    await awaitEffect(log, selectKey(log, 'run.execute'));
    await engine.settle();
    const gate = Object.values(engine.state.gates).find((candidate) => candidate.taskId === taskId);
    expect(calls).toBe(1);
    expect(gate?.type).toBe('failure');
    expect(gate?.body).toBe('no claude');
    expect(keys).toEqual([selectKey(log, 'run.execute')]);
    expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('failed');
    engine.stop();
  });

  test('a cancel is not stuck behind the long-running session it cancels', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
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
    await awaitEffect(log, `run.cancel:${runId}`);
    expect(cancelled).toEqual([runId]);
    engine.stop();
  });

  test('after a restart, work for dead processes is dropped and the rest runs again', async () => {
    const path = createDatabasePath();
    const first = new Engine(new EventLog(path));
    const started = Promise.withResolvers<void>();
    first.onEffect((effect) => {
      if (effect.kind === 'run.execute') started.resolve();
      return new Promise<void>(() => undefined);
    });
    first.start();
    await startPlanning(first);
    await started.promise;
    first.stop();

    const log = new EventLog(path);
    const second = new Engine(log);
    const replayed: string[] = [];
    second.onEffect((effect) => {
      replayed.push(effect.kind);
      return Promise.resolve();
    });
    const info = spyOn(logger, 'info');
    try {
      second.start();
      await awaitEffect(log, selectKey(log, 'task.triage'));
      expect(info).toHaveBeenCalledWith('[Engine] Recovered the effect outbox after a restart', {
        requeued: 1,
        cancelled: 1,
        failed: 0,
      });
    } finally {
      info.mockRestore();
    }
    expect(replayed).toContain('task.triage');
    expect(replayed).not.toContain('run.execute');
    expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('cancelled');
    second.stop();
  });
});

describe('cancelling effects', () => {
  test('cancelling a task stops its running effect at once, frees the lane and ignores its late result', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    const signals: AbortSignal[] = [];
    const late = Promise.withResolvers<void>();
    engine.onEffect((effect, context) => {
      if (effect.kind !== 'task.triage') return Promise.resolve();
      signals.push(context.signal);
      return late.promise;
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await until('the triage to start', () => signals.length === 1);
    const key = selectKey(log, 'task.triage');
    const taskId = Object.keys(engine.state.tasks)[0] ?? '';
    await engine.dispatch({ type: 'task.cancel', taskId });
    await awaitEffect(log, key);
    expect(signals[0]?.aborted).toBe(true);
    late.resolve();
    await engine.settle();
    expect(log.listEffectStatuses().find((row) => row.key === key)?.status).toBe('cancelled');
    engine.stop();
  });

  test('a cancelled effect that fails afterwards is only logged, never retried or failed', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    const late = Promise.withResolvers<void>();
    let started = false;
    engine.onEffect((effect) => {
      if (effect.kind !== 'task.triage') return Promise.resolve();
      started = true;
      return late.promise;
    });
    const warn = spyOn(logger, 'warn');
    try {
      engine.start();
      await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
      await until('the triage to start', () => started);
      await engine.dispatch({ type: 'task.cancel', taskId: Object.keys(engine.state.tasks)[0] ?? '' });
      late.reject(new Error('killed'));
      await until('the late failure to be logged', () => warn.mock.calls.length > 0);
      expect(warn).toHaveBeenCalledWith('[Engine] A cancelled effect failed after it was cancelled', {
        kind: 'task.triage',
        error: 'killed',
      });
    } finally {
      warn.mockRestore();
    }
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toMatchObject({
      status: 'cancelled',
      attempts: 1,
    });
    engine.stop();
  });
});

describe('engine lifecycle', () => {
  test('dispatch reports the events it committed, and nothing for a no-op', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const events = await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    expect(events.map((event) => event.type)).toContain('task.created');
    expect(await engine.dispatch({ type: 'runs.dispatch' })).toEqual([]);
  });

  test('an unsubscribed listener hears nothing more', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });
    await engine.dispatch({ type: 'project.write', project: { name: 'One', color: 'blue' } });
    unsubscribe();
    await engine.dispatch({ type: 'project.write', project: { name: 'Two', color: 'blue' } });
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
    await engine.dispatch({ type: 'task.create', request: 'One', repoId: null });
    await engine.dispatch({ type: 'task.create', request: 'Another', repoId: null });
    await until('both effects', () => calls === 2);
    engine.stop();
    release.resolve();
    fail.reject(new Error('late'));
    await engine.settle();
    await expect(engine.dispatch({ type: 'task.create', request: 'Late', repoId: null })).rejects.toThrow(
      'shutting down'
    );
    expect(
      log.listEffectStatuses().every((row) => row.status === 'running' || row.status === 'pending')
    ).toBe(true);
  });

  test('stopping aborts every running effect, and settle waits until its handler has returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-engine-'));
    dirs.push(dir);
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const pidFile = join(dir, 'pid');
    let finished: CommandResult | null = null;
    engine.onEffect(async (_effect, context) => {
      finished = await runCommand(['sh', '-c', `echo $$ > ${pidFile}; exec sleep 30`], dir, {
        signal: context.signal,
      });
    });
    engine.start();
    await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await until(
      'the command to start',
      () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== ''
    );
    const pid = Number(readFileSync(pidFile, 'utf8'));
    engine.stop();
    await engine.settle();
    expect(finished).toMatchObject({ ok: false });
    expect(() => process.kill(pid, 0)).toThrow();
    expect(log.listEffectStatuses().map((row) => row.status)).toEqual(['running']);
  });

  test('an effect that keeps failing ends after five attempts, and a broken report is only logged', async () => {
    const log = new EventLog(createDatabasePath());
    const engine = new Engine(log);
    const error = spyOn(logger, 'error');
    engine.onEffect((effect) =>
      effect.kind === 'task.triage' ? Promise.reject(new Error('always')) : Promise.resolve()
    );
    engine.onEffectExhausted(() => Promise.reject(new Error('report broke')));
    try {
      engine.start();
      await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
      await awaitEffect(log, selectKey(log, 'task.triage'));
      await engine.settle();
      expect(error).toHaveBeenCalledWith('[Engine] Could not report a failed effect', {
        error: 'report broke',
      });
    } finally {
      error.mockRestore();
    }
    expect(log.listEffectStatuses().find((row) => row.kind === 'task.triage')).toMatchObject({
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
  await engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
  await awaitEffect(log, selectKey(log, 'task.triage'));
  expect(log.listEffectStatuses().map((row) => row.status)).toEqual(['done']);
  engine.onEffect(() => Promise.reject(new Error('gone')));
  await startPlanning(engine);
  await awaitEffect(log, selectKey(log, 'run.execute'));
  expect(log.listEffectStatuses().find((row) => row.kind === 'run.execute')?.status).toBe('failed');
  engine.stop();
});

describe('commands sent on your behalf', () => {
  test('name the task whose agent sent them, and a repeat under the same id is answered from its receipt', async () => {
    const engine = new Engine(new EventLog(createDatabasePath()));
    const { taskId } = await seedTask(engine);
    const options = { id: 'agent:run-1:run-1:1:call:7:1', onBehalf: true, byTask: 'task-b' };
    const command = { type: 'task.prioritize' as const, taskId, priority: 'urgent' as const };
    const events = await engine.dispatch(command, options);
    expect(events.every((event) => event.byTask === 'task-b')).toBe(true);
    expect(engine.state.onBehalfActions).toEqual([expect.objectContaining({ byTaskId: 'task-b' })]);
    const seq = engine.state.seq;
    expect(await engine.dispatch(command, { ...options, byTask: 'task-c' })).toEqual(events);
    expect(engine.state.seq).toBe(seq);
  });
});
