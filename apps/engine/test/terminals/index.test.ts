import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SERVICE_LIMITS,
  type ShinsaState,
  TERMINAL_LIMITS,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Duration, Effect, Layer } from 'effect';
import { ShellLayer } from '../../src/shell/layers.ts';
import { TerminalPty } from '../../src/terminals/pty/service.ts';
import { PortUnavailable, TerminalIds, TerminalTimings } from '../../src/terminals/schema.ts';
import { TYPE_LIMITS } from '../../src/terminals/session.ts';
import { parseStoredService, parseStoredTerminal } from '../../src/terminals/store.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createTempDir } from '../helpers/temp.ts';
import { until } from '../helpers/until.ts';
import { createFakeViewer, createInfo } from './fakes.ts';
import { createTerminals, runAsync } from './harness.ts';

const START = { projectId: 'p1', cwd: '/code/web', place: 'repository', taskId: null } as const;

describe('Terminals', () => {
  it('opens your login shell in the folder, with the terminal’s environment', async () => {
    const { terminals, fake } = await createTerminals();
    const terminal = await runAsync(terminals.create(START));
    expect(terminal).toMatchObject({ id: 'term-1', cwd: '/code/web', status: 'running', startedAt: 100 });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l']);
    expect(fake.spawned[0]?.options.env).toMatchObject({
      TERM_PROGRAM: 'Shinsa',
      TERM_PROGRAM_VERSION: '1.0.0',
    });
    expect(await runAsync(terminals.snapshot)).toEqual({
      terminals: [terminal],
      services: [],
      home: '/home/ada',
    });
  });

  it('tells its listeners and saves the list on every change', async () => {
    const { terminals, dataDir } = await createTerminals();
    const seen: TerminalsSnapshot[] = [];
    const stop = await runAsync(terminals.subscribe((snapshot) => seen.push(snapshot)));
    const first = await runAsync(terminals.create(START));
    await runAsync(terminals.rename(first.id, '  Server  '));
    expect(seen.at(-1)?.terminals[0]?.name).toBe('Server');
    await runAsync(terminals.rename(first.id, '   '));
    expect((await runAsync(terminals.find(first.id))).info.name).toBeNull();
    await runAsync(terminals.rename(first.id, 'x'.repeat(80)));
    expect((await runAsync(terminals.find(first.id))).info.name).toHaveLength(TERMINAL_LIMITS.name);
    const saved = JSON.parse(readFileSync(join(dataDir, 'terminals/terminals.json'), 'utf8'));
    expect(saved.terminals[0].id).toBe(first.id);
    await runAsync(stop);
    await runAsync(terminals.rename(first.id, null));
    expect(seen.at(-1)?.terminals[0]?.name).toHaveLength(TERMINAL_LIMITS.name);
    await runAsync(terminals.stop);
  });

  it('puts a project’s terminals in the order you give, leaving other projects where they are', async () => {
    const { terminals } = await createTerminals();
    const a = await runAsync(terminals.create(START));
    const other = await runAsync(terminals.create({ ...START, projectId: 'p2' }));
    const b = await runAsync(terminals.create(START));
    const c = await runAsync(terminals.create(START));
    await runAsync(terminals.reorder('p1', [c.id, 'unknown', a.id]));
    expect((await runAsync(terminals.snapshot)).terminals.map((each) => each.id)).toEqual([
      c.id,
      other.id,
      a.id,
      b.id,
    ]);
  });

  it('types into a shell that never goes quiet once the wait is over, and never into one that ended', async () => {
    const saved = TYPE_LIMITS.waitMs;
    TYPE_LIMITS.waitMs = 200;
    try {
      const { terminals, fake } = await createTerminals();
      const silent = await runAsync(terminals.create(START));
      await runAsync(terminals.run(silent.id, 'ls'));
      await until('typed after the wait', () => fake.spawned[0]?.written.length === 2);
      expect(fake.spawned[0]?.written).toEqual(['ls', '\r']);
      const ending = await runAsync(terminals.create(START));
      await runAsync(terminals.run(ending.id, 'ls'));
      fake.spawned[1]?.exit(0);
      await Bun.sleep(400);
      expect(fake.spawned[1]?.written).toEqual([]);
    } finally {
      TYPE_LIMITS.waitMs = saved;
    }
  });

  it('runs a command you asked for, starts an ended shell again and closes one for good', async () => {
    const { terminals, fake, dataDir } = await createTerminals();
    const terminal = await runAsync(terminals.create(START));
    await runAsync(terminals.run(terminal.id, 'bun dev'));
    expect(fake.spawned[0]?.written).toEqual([]);
    fake.spawned[0]?.emit('~ ⟩ ');
    await until('the command is typed', () => fake.spawned[0]?.written.length === 2);
    expect(fake.spawned[0]?.written).toEqual(['bun dev', '\r']);
    expect((await runAsync(terminals.restart(terminal.id))).status).toBe('running');
    expect(fake.spawned).toHaveLength(1);
    fake.spawned[0]?.emit('output');
    fake.spawned[0]?.exit(0);
    await until(
      'the shell ends',
      async () => (await runAsync(terminals.find(terminal.id))).info.status === 'exited'
    );
    await expect(runAsync(terminals.run(terminal.id, 'ls'))).rejects.toThrow('That terminal has ended.');
    expect((await runAsync(terminals.restart(terminal.id))).status).toBe('running');
    expect(fake.spawned).toHaveLength(2);
    await until(
      'the screen is saved',
      async () => (await runAsync(terminals.select(terminal.id))) !== null && hasScreen(dataDir, terminal.id)
    );
    const viewer = createFakeViewer();
    await runAsync(terminals.attach(terminal.id, viewer));
    await runAsync(terminals.close(terminal.id));
    expect(viewer.ended).toBe(true);
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(await runAsync(terminals.select(terminal.id))).toBeNull();
    expect(hasScreen(dataDir, terminal.id)).toBe(false);
    await expect(runAsync(terminals.find(terminal.id))).rejects.toThrow('That terminal is closed.');
  });

  it('keeps a terminal’s last screen across a restart of the engine, as stopped', async () => {
    const { terminals, fake, dataDir } = await createTerminals();
    const terminal = await runAsync(terminals.create(START));
    fake.spawned[0]?.emit('dev server on :3000\r\n');
    await runAsync(terminals.stop);
    const again = (await createTerminals({ dataDir })).terminals;
    const restored = await runAsync(again.find(terminal.id));
    expect(restored.info).toMatchObject({ status: 'stopped', endedAt: 100 });
    expect(await runAsync(restored.serializeScreen)).toContain('dev server on :3000');
    expect((await runAsync(again.snapshot)).terminals).toHaveLength(1);
  });

  it('marks a terminal still running in the saved list as stopped when the engine comes back', async () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(
      join(dataDir, 'terminals/terminals.json'),
      JSON.stringify({
        terminals: [
          createInfo({ id: 'kept' }),
          createInfo({ id: 'done', status: 'exited', endedAt: 5 }),
          { id: 1 },
        ],
      })
    );
    const { terminals } = await createTerminals({ dataDir });
    expect(
      (await runAsync(terminals.snapshot)).terminals.map((each) => [each.id, each.status, each.endedAt])
    ).toEqual([
      ['kept', 'stopped', 100],
      ['done', 'exited', 5],
    ]);
  });

  it('starts with no terminals when the saved list cannot be read', async () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(join(dataDir, 'terminals/terminals.json'), '{');
    const logs = captureLogs();
    expect((await runAsync((await createTerminals({ dataDir })).terminals.snapshot)).terminals).toEqual([]);
    logs.restore();
    expect(logs.fieldsOf('[Terminals] Could not read the saved terminals')).toHaveLength(1);
    writeFileSync(join(dataDir, 'terminals/terminals.json'), 'null');
    expect((await runAsync((await createTerminals({ dataDir })).terminals.snapshot)).terminals).toEqual([]);
  });

  it('refuses more terminals than the limit, and any change while Shinsa only shows saved state', async () => {
    const { terminals } = await createTerminals();
    for (let index = 0; index < TERMINAL_LIMITS.terminals; index++) await runAsync(terminals.create(START));
    await expect(runAsync(terminals.create(START))).rejects.toThrow(
      `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run. ${TERMINAL_LIMITS.terminals} are yours. Stop a service or close a terminal to free one.`
    );
    expect((await runAsync(terminals.snapshot)).terminals).toHaveLength(TERMINAL_LIMITS.terminals);
    const readOnly = (await createTerminals({ readOnly: true })).terminals;
    await expect(runAsync(readOnly.create(START))).rejects.toThrow('Terminals are off');
  });

  it('says what runs in a shell in front of it, and nothing for an ended one', async () => {
    const { terminals, fake } = await createTerminals();
    const terminal = await runAsync(terminals.create(START));
    expect(await runAsync(terminals.readForeground(terminal.id))).toEqual({ program: 'vim' });
    fake.spawned[0]?.exit(0);
    await until(
      'the shell ends',
      async () => (await runAsync(terminals.find(terminal.id))).info.status === 'exited'
    );
    expect(await runAsync(terminals.readForeground(terminal.id))).toEqual({ program: null });
  });
});

const STATE = {
  repos: { web: { id: 'web', name: 'web', path: '/code/web', projectId: 'p1' } },
  projects: { p1: { id: 'p1', name: 'Shop', folders: [] } },
  tasks: {},
} as unknown as ShinsaState;

const SERVICE = {
  name: 'api',
  cwd: '/code/web/apps/api',
  command: 'bun run dev',
  env: { PORT: '4000' },
  previewUrl: null,
  portVariable: 'PORT',
};

function main(place: TerminalPlaceKind, cwd = SERVICE.cwd) {
  return { cwd, place, taskId: null };
}

describe('Terminals services', () => {
  it('runs a service’s command in your login shell, with its variables, in a terminal of its own', async () => {
    const { terminals, fake, dataDir } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    expect(service).toEqual({ id: 'term-1', projectId: 'p1', ...SERVICE });
    expect(JSON.parse(readFileSync(join(dataDir, 'terminals/services.json'), 'utf8')).services).toEqual([
      service,
    ]);
    const terminal = await runAsync(terminals.startService(service.id, main('repository')));
    expect(terminal).toMatchObject({
      serviceId: service.id,
      name: 'api',
      cwd: SERVICE.cwd,
      status: 'running',
    });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l', '-c', 'bun run dev']);
    expect(fake.spawned[0]?.options.env).toMatchObject({ PORT: '4000', PATH: '/bin' });
    expect((await runAsync(terminals.startService(service.id, main('repository')))).id).toBe(terminal.id);
    expect(fake.spawned).toHaveLength(1);
    expect(await runAsync(terminals.readForeground(terminal.id))).toEqual({ program: 'api' });
    await runAsync(terminals.stopService(service.id, null));
    expect((await runAsync(terminals.find(terminal.id))).info.status).toBe('stopped');
    expect(fake.spawned[0]?.hungUp).toBe(true);
    await runAsync(terminals.startService(service.id, main('folder')));
    expect((await runAsync(terminals.find(terminal.id))).info).toMatchObject({
      status: 'running',
      place: 'folder',
    });
    expect(fake.spawned).toHaveLength(2);
  });

  it('reads the last lines a service printed, and nothing for one that has not run', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 10))).toEqual([]);
    await runAsync(terminals.startService(service.id, main('repository')));
    fake.spawned[0]?.emit('listening on 4000\r\nready\r\n');
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 1))).toEqual(['ready']);
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 10))).toEqual([
      'listening on 4000',
      'ready',
    ]);
  });

  it('restarts a running service, stopping it first, and starts a stopped one', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    await runAsync(terminals.restartService(service.id, main('repository')));
    expect(fake.spawned).toHaveLength(1);
    const again = await runAsync(terminals.restartService(service.id, main('repository')));
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(again.status).toBe('running');
    fake.spawned[1]?.exit(1);
    await until('it fails', async () => (await runAsync(terminals.find(again.id))).info.exitCode === 1);
    expect((await runAsync(terminals.find(again.id))).info.status).toBe('exited');
  });

  it('renames a service’s terminal with it, and removing it closes the terminal', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    await runAsync(terminals.updateService(service.id, { ...SERVICE, name: 'backend' }));
    const terminal = await runAsync(terminals.startService(service.id, main('repository')));
    expect(terminal.name).toBe('backend');
    await runAsync(terminals.updateService(service.id, { ...SERVICE, name: 'server', command: 'bun start' }));
    expect((await runAsync(terminals.find(terminal.id))).info.name).toBe('server');
    await runAsync(terminals.removeServices([service.id]));
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(await runAsync(terminals.snapshot)).toMatchObject({ services: [], terminals: [] });
    await expect(runAsync(terminals.findService(service.id))).rejects.toThrow(
      'That service is not there anymore.'
    );
    await runAsync(terminals.removeServices([(await runAsync(terminals.addService('p1', SERVICE))).id]));
    await runAsync(terminals.stopService((await runAsync(terminals.addService('p1', SERVICE))).id, null));
  });

  it('starts again the services that ran when the engine stopped, where their folder still is', async () => {
    const { terminals, dataDir } = await createTerminals();
    const kept = await runAsync(terminals.addService('p1', SERVICE));
    const moved = await runAsync(terminals.addService('p1', { ...SERVICE, name: 'web', cwd: '/elsewhere' }));
    const idle = await runAsync(terminals.addService('p1', { ...SERVICE, name: 'docs' }));
    await runAsync(terminals.startService(kept.id, main('repository')));
    await runAsync(terminals.startService(moved.id, main('repository', '/elsewhere')));
    await runAsync(terminals.startService(idle.id, main('repository')));
    await runAsync(terminals.stopService(idle.id, null));
    await runAsync(terminals.create(START));
    await runAsync(terminals.stop);
    const again = await createTerminals({ dataDir });
    await runAsync(again.terminals.resumeServices(STATE));
    expect(again.fake.spawned.map((each) => each.options.cwd)).toEqual([SERVICE.cwd]);
    expect((await runAsync(again.terminals.snapshot)).terminals.map((each) => each.status)).toEqual([
      'running',
      'stopped',
      'stopped',
      'stopped',
    ]);
    await runAsync(again.terminals.resumeServices(STATE));
    expect(again.fake.spawned).toHaveLength(1);
    const readOnly = await createTerminals({ dataDir, readOnly: true });
    await runAsync(readOnly.terminals.resumeServices(STATE));
    expect(readOnly.fake.spawned).toHaveLength(0);
  });

  it('runs a service for a task beside its main run, each in a tab of its own', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const onMain = await runAsync(terminals.startService(service.id, main('repository')));
    const forTask = await runAsync(
      terminals.startService(service.id, {
        cwd: '/wt/a/apps/api',
        place: 'worktree',
        taskId: 'a',
      })
    );
    expect(forTask).toMatchObject({ name: 'api', serviceId: service.id, taskId: 'a', cwd: '/wt/a/apps/api' });
    expect(forTask.id).not.toBe(onMain.id);
    expect(fake.spawned.map((each) => each.options.cwd)).toEqual([SERVICE.cwd, '/wt/a/apps/api']);
    await runAsync(terminals.stopService(service.id, 'a'));
    expect((await runAsync(terminals.find(forTask.id))).info.status).toBe('stopped');
    expect((await runAsync(terminals.find(onMain.id))).info.status).toBe('running');
    await runAsync(terminals.updateService(service.id, { ...SERVICE, name: 'backend' }));
    const names = await Promise.all(
      [onMain.id, forTask.id].map(async (id) => (await runAsync(terminals.find(id))).info.name)
    );
    expect(names).toEqual(['backend', 'backend']);
    await runAsync(terminals.removeServices([service.id]));
    expect((await runAsync(terminals.snapshot)).terminals).toEqual([]);
  });

  it('closes a task’s service runs and ended shells, and leaves its running shells and other runs alone', async () => {
    const { terminals, fake } = await createTerminals();
    const seen: TerminalsSnapshot[] = [];
    await runAsync(Effect.asVoid(terminals.subscribe((snapshot) => seen.push(snapshot))));
    const service = await runAsync(terminals.addService('p1', SERVICE));
    await runAsync(terminals.startService(service.id, main('repository')));
    await runAsync(terminals.startService(service.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    await runAsync(terminals.startService(service.id, { cwd: '/wt/b', place: 'worktree', taskId: 'b' }));
    const shell = await runAsync(
      terminals.create({ ...START, cwd: '/wt/a', place: 'worktree', taskId: 'a' })
    );
    const ended = await runAsync(
      terminals.create({ ...START, cwd: '/wt/a', place: 'worktree', taskId: 'a' })
    );
    fake.spawned[4]?.exit(0);
    await until('the shell’s exit is published', async () =>
      seen.some((snapshot) =>
        snapshot.terminals.some((each) => each.id === ended.id && each.status === 'exited')
      )
    );
    const before = seen.length;
    await runAsync(terminals.closeTaskTerminals('a'));
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(
      (await runAsync(terminals.snapshot)).terminals.map((each) => [each.taskId, each.serviceId])
    ).toEqual([
      [null, service.id],
      ['b', service.id],
      ['a', null],
    ]);
    expect(seen.length).toBe(before + 1);
    await runAsync(terminals.closeTaskTerminals('gone'));
    expect(seen.length).toBe(before + 1);
    expect((await runAsync(terminals.find(shell.id))).info.status).toBe('running');
    expect(await runAsync(terminals.listTerminalPids)).toEqual([1003]);
    expect(await runAsync(terminals.listServiceProcesses)).toEqual([{ taskId: 'b', pid: 1002 }]);
  });

  it('starts a task’s run again after a restart only while the task is open', async () => {
    const { terminals, dataDir } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    for (const taskId of ['open', 'merged', 'gone'])
      await runAsync(terminals.startService(service.id, { cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    await runAsync(terminals.stop);
    const state = {
      ...STATE,
      tasks: {
        open: { id: 'open', stage: 'building', repoId: 'web', worktreePath: '/wt/open' },
        merged: { id: 'merged', stage: 'merged', repoId: 'web', worktreePath: '/wt/merged' },
      },
    } as unknown as ShinsaState;
    const again = await createTerminals({ dataDir });
    await runAsync(again.terminals.resumeServices(state));
    expect(again.fake.spawned.map((each) => each.options.cwd)).toEqual(['/wt/open/apps/api']);
  });

  it('drops the ended terminals of finished and unknown tasks on start, and keeps yours and open tasks’', async () => {
    const { terminals, dataDir } = await createTerminals();
    for (const taskId of ['open', 'merged', 'done', 'cancelled', 'gone'])
      await runAsync(terminals.create({ ...START, cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    await runAsync(terminals.create(START));
    await runAsync(terminals.stop);
    const stages = { open: 'building', merged: 'merged', done: 'done', cancelled: 'cancelled' };
    const state = {
      ...STATE,
      tasks: Object.fromEntries(Object.entries(stages).map(([id, stage]) => [id, { id, stage }])),
    } as unknown as ShinsaState;
    const again = await createTerminals({ dataDir });
    const seen: TerminalsSnapshot[] = [];
    await runAsync(Effect.asVoid(again.terminals.subscribe((snapshot) => seen.push(snapshot))));
    await runAsync(again.terminals.resumeServices(state));
    expect((await runAsync(again.terminals.snapshot)).terminals.map((each) => each.taskId)).toEqual([
      'open',
      null,
    ]);
    const before = seen.length;
    await runAsync(again.terminals.resumeServices(state));
    expect(seen.length).toBe(before);
    const reread = await createTerminals({ dataDir });
    expect((await runAsync(reread.terminals.snapshot)).terminals.map((each) => each.taskId)).toEqual([
      'open',
      null,
    ]);
  });

  it('forgets the service of a saved terminal whose service is gone', async () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(
      join(dataDir, 'terminals/terminals.json'),
      JSON.stringify({ terminals: [createInfo({ id: 'orphan', serviceId: 'gone' })] })
    );
    writeFileSync(join(dataDir, 'terminals/services.json'), '{');
    const logs = captureLogs();
    const { terminals } = await createTerminals({ dataDir });
    logs.restore();
    expect(logs.fieldsOf('[Terminals] Could not read the saved services')).toHaveLength(1);
    expect((await runAsync(terminals.snapshot)).terminals[0]).toMatchObject({
      serviceId: null,
      status: 'stopped',
    });
  });

  it('adds the address a running service is reached at from elsewhere, publishes it again when asked, and never saves it', async () => {
    const { terminals, dataDir } = await createTerminals();
    const service = await runAsync(
      terminals.addService('p1', { ...SERVICE, previewUrl: 'http://localhost:{port}/' })
    );
    const terminal = await runAsync(terminals.startService(service.id, main('repository')));
    await runAsync(terminals.create(START));
    let address = 'https://one.shinsa.page/';
    const asked: string[] = [];
    const published: TerminalsSnapshot[] = [];
    await runAsync(Effect.asVoid(terminals.subscribe((snapshot) => published.push(snapshot))));
    const changed = new Set<() => void>();
    await runAsync(
      terminals.applyRemoteUrls({
        resolveRemoteUrl: (info, each) =>
          Effect.sync(() => {
            asked.push(`${info.id} ${each.id}`);
            return address;
          }),
        subscribe: (listener) => changed.add(listener),
      })
    );
    await until('the snapshot goes out again', () => published.length === 1);
    expect(published[0]?.terminals.find((each) => each.id === terminal.id)?.remoteUrl).toBe(address);
    expect(published[0]?.terminals.find((each) => each.id !== terminal.id)?.remoteUrl).toBeUndefined();
    expect(asked).toContain(`${terminal.id} ${service.id}`);
    address = 'https://two.shinsa.page/';
    for (const listener of changed) listener();
    await until('the new address goes out', () => published.length === 2);
    expect(published[1]?.terminals.find((each) => each.id === terminal.id)?.remoteUrl).toBe(address);
    const saved = JSON.parse(readFileSync(join(dataDir, 'terminals/terminals.json'), 'utf8'));
    expect(JSON.stringify(saved)).not.toContain('shinsa.page');
  });

  it('gives each task run a free port of its own in the service’s port variable', async () => {
    const { terminals, fake } = await createTerminals();
    const preview = { ...SERVICE, previewUrl: 'http://localhost:{port}/tasks', portVariable: 'APP_PORT' };
    const service = await runAsync(terminals.addService('p1', preview));
    const runFor = (taskId: string) =>
      runAsync(terminals.startService(service.id, { cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    const a = await runFor('a');
    const b = await runFor('b');
    expect([a.port, b.port]).toEqual([5001, 5002]);
    expect(fake.spawned.map((each) => each.options.env.APP_PORT)).toEqual(['5001', '5002']);
    expect(fake.spawned[0]?.options.env.PORT).toBe('4000');
    await runAsync(terminals.stopService(service.id, 'a'));
    await runFor('c');
    expect((await runAsync(terminals.find(a.id))).info.port).toBe(5001);
    expect((await runFor('a')).port).toBe(5003);
  });

  it('gives a task run its own variables, under the service’s, and keeps them across a restart', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(
      terminals.addService('p1', {
        ...SERVICE,
        env: { PORT: '4000', TURBO_CACHE_DIR: '/mine' },
      })
    );
    const plain = await runAsync(terminals.addService('p1', { ...SERVICE, name: 'api', env: {} }));
    const forTask = {
      cwd: '/wt/a',
      place: 'worktree',
      taskId: 'a',
      env: { TURBO_CACHE_DIR: '/shared', A: '1' },
    } as const;
    await runAsync(terminals.startService(plain.id, forTask));
    expect(fake.spawned[0]?.options.env).toMatchObject({ TURBO_CACHE_DIR: '/shared', A: '1' });
    await runAsync(terminals.startService(service.id, forTask));
    expect(fake.spawned[1]?.options.env).toMatchObject({ TURBO_CACHE_DIR: '/mine', A: '1' });
    await runAsync(terminals.restartService(plain.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    expect(fake.spawned[2]?.options.env.TURBO_CACHE_DIR).toBeUndefined();
  });

  it('keeps a task run’s port across a restart while no other run holds it', async () => {
    const { terminals } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const forTask = { cwd: '/wt/a', place: 'worktree', taskId: 'a' } as const;
    const first = await runAsync(terminals.startService(service.id, forTask));
    expect((await runAsync(terminals.restartService(service.id, forTask))).port).toBe(first.port);
  });

  it('comes back on the same port when the last run lets go of it late', async () => {
    const pty = Effect.runSync(
      TerminalPty.use((real) => Effect.succeed(real)).pipe(
        Effect.provide(TerminalPty.layer.pipe(Layer.provide(ShellLayer)))
      )
    );
    const { terminals } = await createTerminals({ pty: { pickPort: pty.pickPort } });
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const forTask = { cwd: '/wt/a', place: 'worktree', taskId: 'a' } as const;
    const first = await runAsync(terminals.startService(service.id, forTask));
    const port = first.port ?? 0;
    const lingering = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });
    setTimeout(() => lingering.stop(true), 300);
    expect((await runAsync(terminals.restartService(service.id, forTask))).port).toBe(port);
  });

  it('leaves your run’s port to its command unless the service has a preview URL', async () => {
    const { terminals, fake } = await createTerminals();
    const plain = await runAsync(terminals.addService('p1', { ...SERVICE, env: {} }));
    expect((await runAsync(terminals.startService(plain.id, main('repository')))).port).toBeNull();
    expect(fake.spawned[0]?.options.env.PORT).toBeUndefined();
    const fixed = await runAsync(
      terminals.addService('p1', {
        ...SERVICE,
        name: 'web',
        previewUrl: 'http://localhost:{port}',
      })
    );
    expect((await runAsync(terminals.startService(fixed.id, main('repository')))).port).toBe(4000);
    expect(fake.spawned[1]?.options.env.PORT).toBe('4000');
    const picked = await runAsync(
      terminals.addService('p1', {
        ...SERVICE,
        name: 'docs',
        env: {},
        previewUrl: 'http://localhost:{port}',
      })
    );
    expect((await runAsync(terminals.startService(picked.id, main('repository')))).port).toBe(5001);
    expect(fake.spawned[2]?.options.env.PORT).toBe('5001');
  });

  it('says so when the machine has no free port for a task’s run', async () => {
    const { terminals, fake } = await createTerminals({
      pty: {
        readForeground: () => Effect.succeed(null),
        pickPort: () => Effect.fail(new PortUnavailable({ message: 'No free port for the service.' })),
      },
    });
    const service = await runAsync(
      terminals.addService('p1', { ...SERVICE, previewUrl: 'http://localhost:{port}' })
    );
    const failure = await runAsync(
      Effect.flip(terminals.startService(service.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }))
    );
    expect(failure).toMatchObject({
      code: 'service_port_unavailable',
      message: 'No free port for the service.',
    });
    expect(fake.spawned).toHaveLength(0);
  });

  it('refuses more services than the limit', async () => {
    const { terminals } = await createTerminals();
    for (let index = 0; index < SERVICE_LIMITS.services; index++)
      await runAsync(terminals.addService('p1', SERVICE));
    const names = Array.from({ length: SERVICE_LIMITS.services }, () => SERVICE.name);
    await expect(runAsync(terminals.addService('p1', SERVICE))).rejects.toThrow(
      `This project keeps ${SERVICE_LIMITS.services} services at most, and has ${SERVICE_LIMITS.services}: ${new Intl.ListFormat('en').format(names)}. Remove one under Services to add another.`
    );
    expect((await runAsync(terminals.addService('p2', SERVICE))).projectId).toBe('p2');
    await expect(
      runAsync((await createTerminals({ readOnly: true })).terminals.addService('p1', SERVICE))
    ).rejects.toThrow('Terminals are off');
  });
});

describe('parseStoredService', () => {
  const service = { id: 's1', projectId: 'p1', ...SERVICE };

  it('keeps only well-formed services', async () => {
    expect(parseStoredService(service)).toEqual(service);
    expect(parseStoredService({ ...service, extra: true })).toEqual(service);
    expect(parseStoredService(null)).toBeNull();
    expect(parseStoredService({ ...service, id: '../x' })).toBeNull();
    expect(parseStoredService({ ...service, name: '' })).toBeNull();
    expect(parseStoredService({ ...service, env: { 'A-B': 'x' } })).toBeNull();
    expect(parseStoredService({ ...service, env: { A: 1 } })).toBeNull();
    expect(parseStoredService({ ...service, env: [] })).toBeNull();
    expect(parseStoredService({ ...service, env: null })).toBeNull();
    expect(parseStoredService({ ...service, previewUrl: 'file:///etc' })).toBeNull();
    expect(parseStoredService({ ...service, previewUrl: 'http://localhost:3000' })).toBeNull();
    expect(parseStoredService({ ...service, previewUrl: 3 })).toBeNull();
    expect(parseStoredService({ ...service, portVariable: 'A-B' })).toBeNull();
    const preview = { ...service, previewUrl: 'http://localhost:{port}', portVariable: 'APP_PORT' };
    expect(parseStoredService(preview)).toEqual(preview);
  });

  it('reads a service saved before previews with none, on PORT', async () => {
    const { previewUrl, portVariable, ...saved } = service;
    expect(parseStoredService(saved)).toEqual({ ...saved, previewUrl: null, portVariable: 'PORT' });
  });
});

describe('parseStoredTerminal', () => {
  it('keeps only well-formed terminals', async () => {
    expect(parseStoredTerminal(createInfo())).toEqual(createInfo());
    expect(parseStoredTerminal(null)).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), id: '../x' })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), status: 'paused' })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), name: 3 })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), serviceId: 3 })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), startedAt: '1' })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), port: 0 })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), port: 70000 })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), port: 4000 })).toEqual(createInfo({ port: 4000 }));
  });

  it('reads a terminal saved before services as a shell of its own', async () => {
    const { serviceId, port, ...saved } = createInfo();
    expect([serviceId, port]).toEqual([null, null]);
    expect(parseStoredTerminal(saved)).toEqual(createInfo());
  });
});

function hasScreen(dataDir: string, id: string) {
  try {
    readFileSync(join(dataDir, `terminals/${id}.screen`));
    return true;
  } catch {
    return false;
  }
}

describe('the terminals’ defaults', () => {
  it('publishes changes after 50 ms, saves screens every 2 s and names terminals with UUIDv7 ids', async () => {
    const { timings, id } = await runAsync(
      Effect.gen(function* () {
        return { timings: yield* TerminalTimings, id: yield* yield* TerminalIds };
      })
    );
    expect([timings.notify, timings.screen].map(Duration.toMillis)).toEqual([50, 2_000]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

const TASKS = {
  open: { handle: 'LOC-169', stage: 'building' },
  done: { handle: 'LOC-28', stage: 'merged' },
} as unknown as ShinsaState['tasks'];

describe('Terminals at the limit', () => {
  it('closes ended terminals to make room: finished tasks first, then services, task shells and your own, oldest first', async () => {
    let clock = 100;
    const { terminals, fake } = await createTerminals({ now: () => clock, tasks: TASKS });
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const ending = [
      await runAsync(terminals.create(START)),
      await runAsync(terminals.create({ ...START, taskId: 'open' })),
      await runAsync(terminals.startService(service.id, { ...main('repository'), taskId: 'open' })),
      await runAsync(terminals.create({ ...START, taskId: 'gone' })),
      await runAsync(terminals.create({ ...START, taskId: 'done' })),
    ];
    for (const [index, terminal] of ending.entries()) {
      clock = 200 - index;
      if (terminal.serviceId) await runAsync(terminals.stopService(service.id, 'open'));
      else fake.spawned[index]?.exit(0);
      await until(
        'it ends',
        async () => (await runAsync(terminals.find(terminal.id))).info.status !== 'running'
      );
    }
    while ((await runAsync(terminals.snapshot)).terminals.length < TERMINAL_LIMITS.terminals)
      await runAsync(terminals.create(START));
    const [yours, taskShell, stopped, gone, done] = ending.map((terminal) => terminal.id);
    const left = async () => (await runAsync(terminals.snapshot)).terminals.map((terminal) => terminal.id);
    for (const reclaimed of [done, gone, stopped, taskShell, yours]) {
      await runAsync(terminals.create(START));
      expect(await left()).not.toContain(reclaimed);
      expect(await left()).toHaveLength(TERMINAL_LIMITS.terminals);
    }
    expect(await left()).toEqual(expect.not.arrayContaining(ending.map((terminal) => terminal.id)));
    await expect(runAsync(terminals.create(START))).rejects.toThrow('all of them run.');
    await runAsync(terminals.stop);
  });

  it('starts a service in a full list by closing an ended terminal', async () => {
    const { terminals, fake } = await createTerminals();
    const service = await runAsync(terminals.addService('p1', SERVICE));
    const ended = await runAsync(terminals.create(START));
    fake.spawned[0]?.exit(1);
    await until(
      'the shell ends',
      async () => (await runAsync(terminals.find(ended.id))).info.status === 'exited'
    );
    while ((await runAsync(terminals.snapshot)).terminals.length < TERMINAL_LIMITS.terminals)
      await runAsync(terminals.create(START));
    const started = await runAsync(
      terminals.startService(service.id, { ...main('repository'), taskId: 'open' })
    );
    expect(started.status).toBe('running');
    expect((await runAsync(terminals.snapshot)).terminals.map((terminal) => terminal.id)).not.toContain(
      ended.id
    );
    await runAsync(terminals.stop);
  });

  it('names the tasks and services that hold every running terminal when it refuses', async () => {
    const { terminals } = await createTerminals({ tasks: TASKS });
    const seeded = await runAsync(terminals.addService('p1', { ...SERVICE, name: 'seeded' }));
    const sandbox = await runAsync(terminals.addService('p1', { ...SERVICE, name: 'sandbox' }));
    await runAsync(terminals.startService(seeded.id, { ...main('repository'), taskId: 'open' }));
    await runAsync(terminals.startService(sandbox.id, { ...main('repository'), taskId: 'open' }));
    await runAsync(terminals.create({ ...START, taskId: 'open' }));
    await runAsync(terminals.create({ ...START, taskId: 'gone' }));
    await runAsync(terminals.create({ ...START, taskId: 'gone' }));
    await runAsync(terminals.create(START));
    while ((await runAsync(terminals.snapshot)).terminals.length < TERMINAL_LIMITS.terminals - 1)
      await runAsync(terminals.create(START));
    await runAsync(terminals.create({ ...START, taskId: 'done' }));
    await expect(runAsync(terminals.create(START))).rejects.toThrow(
      `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run. LOC-169 runs seeded, sandbox, and a shell. Another task runs 2 shells. LOC-28 runs a shell. ${TERMINAL_LIMITS.terminals - 6} are yours. Stop a service or close a terminal to free one.`
    );
    await runAsync(terminals.stop);
  });

  it('counts a single terminal of yours in the singular', async () => {
    const { terminals } = await createTerminals({ tasks: TASKS });
    await runAsync(terminals.create(START));
    while ((await runAsync(terminals.snapshot)).terminals.length < TERMINAL_LIMITS.terminals)
      await runAsync(terminals.create({ ...START, taskId: 'open' }));
    await expect(runAsync(terminals.create(START))).rejects.toThrow(
      `all of them run. LOC-169 runs ${TERMINAL_LIMITS.terminals - 1} shells. 1 is yours.`
    );
    await runAsync(terminals.stop);
  });

  it('keeps a service that waits to resume after a restart, and closes an ended shell instead', async () => {
    const dataDir = createTempDir();
    const first = (await createTerminals({ dataDir })).terminals;
    const service = await runAsync(first.addService('p1', SERVICE));
    const waiting = await runAsync(first.startService(service.id, { ...main('repository'), taskId: 'open' }));
    while ((await runAsync(first.snapshot)).terminals.length < TERMINAL_LIMITS.terminals)
      await runAsync(first.create(START));
    await runAsync(first.stop);
    const again = (await createTerminals({ dataDir, idPrefix: 'fresh' })).terminals;
    await runAsync(again.create(START));
    const left = (await runAsync(again.snapshot)).terminals.map((terminal) => terminal.id);
    expect(left).toContain(waiting.id);
    expect(left).toContain('fresh-1');
    expect(left).toHaveLength(TERMINAL_LIMITS.terminals);
  });
});
