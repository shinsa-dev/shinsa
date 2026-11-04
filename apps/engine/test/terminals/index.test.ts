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
import { Duration, Effect } from 'effect';
import { PortUnavailable, TerminalIds, TerminalTimings } from '../../src/terminals/schema.ts';
import { TYPE_LIMITS } from '../../src/terminals/session.ts';
import { parseStoredService, parseStoredTerminal } from '../../src/terminals/store.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createTempDir } from '../helpers/temp.ts';
import { until } from '../helpers/until.ts';
import { createFakeViewer, createInfo } from './fakes.ts';
import { createTerminals, run, runAsync } from './harness.ts';

const START = { projectId: 'p1', cwd: '/code/web', place: 'repository', taskId: null } as const;

describe('Terminals', () => {
  it('opens your login shell in the folder, with the terminal’s environment', () => {
    const { terminals, fake } = createTerminals();
    const terminal = run(terminals.create(START));
    expect(terminal).toMatchObject({ id: 'term-1', cwd: '/code/web', status: 'running', startedAt: 100 });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l']);
    expect(fake.spawned[0]?.options.env).toMatchObject({
      TERM_PROGRAM: 'Shinsa',
      TERM_PROGRAM_VERSION: '1.0.0',
    });
    expect(run(terminals.snapshot)).toEqual({ terminals: [terminal], services: [], home: '/home/ada' });
  });

  it('tells its listeners and saves the list on every change', async () => {
    const { terminals, dataDir } = createTerminals();
    const seen: TerminalsSnapshot[] = [];
    const stop = run(terminals.subscribe((snapshot) => seen.push(snapshot)));
    const first = run(terminals.create(START));
    run(terminals.rename(first.id, '  Server  '));
    expect(seen.at(-1)?.terminals[0]?.name).toBe('Server');
    run(terminals.rename(first.id, '   '));
    expect(run(terminals.find(first.id)).info.name).toBeNull();
    run(terminals.rename(first.id, 'x'.repeat(80)));
    expect(run(terminals.find(first.id)).info.name).toHaveLength(TERMINAL_LIMITS.name);
    const saved = JSON.parse(readFileSync(join(dataDir, 'terminals/terminals.json'), 'utf8'));
    expect(saved.terminals[0].id).toBe(first.id);
    run(stop);
    run(terminals.rename(first.id, null));
    expect(seen.at(-1)?.terminals[0]?.name).toHaveLength(TERMINAL_LIMITS.name);
    await runAsync(terminals.stop);
  });

  it('puts a project’s terminals in the order you give, leaving other projects where they are', () => {
    const { terminals } = createTerminals();
    const a = run(terminals.create(START));
    const other = run(terminals.create({ ...START, projectId: 'p2' }));
    const b = run(terminals.create(START));
    const c = run(terminals.create(START));
    run(terminals.reorder('p1', [c.id, 'unknown', a.id]));
    expect(run(terminals.snapshot).terminals.map((each) => each.id)).toEqual([c.id, other.id, a.id, b.id]);
  });

  it('types into a shell that never goes quiet once the wait is over, and never into one that ended', async () => {
    const saved = TYPE_LIMITS.waitMs;
    TYPE_LIMITS.waitMs = 200;
    try {
      const { terminals, fake } = createTerminals();
      const silent = run(terminals.create(START));
      run(terminals.run(silent.id, 'ls'));
      await until('typed after the wait', () => fake.spawned[0]?.written.length === 2);
      expect(fake.spawned[0]?.written).toEqual(['ls', '\r']);
      const ending = run(terminals.create(START));
      run(terminals.run(ending.id, 'ls'));
      fake.spawned[1]?.exit(0);
      await Bun.sleep(400);
      expect(fake.spawned[1]?.written).toEqual([]);
    } finally {
      TYPE_LIMITS.waitMs = saved;
    }
  });

  it('runs a command you asked for, starts an ended shell again and closes one for good', async () => {
    const { terminals, fake, dataDir } = createTerminals();
    const terminal = run(terminals.create(START));
    run(terminals.run(terminal.id, 'bun dev'));
    expect(fake.spawned[0]?.written).toEqual([]);
    fake.spawned[0]?.emit('~ ⟩ ');
    await until('the command is typed', () => fake.spawned[0]?.written.length === 2);
    expect(fake.spawned[0]?.written).toEqual(['bun dev', '\r']);
    expect(run(terminals.restart(terminal.id)).status).toBe('running');
    expect(fake.spawned).toHaveLength(1);
    fake.spawned[0]?.emit('output');
    fake.spawned[0]?.exit(0);
    await until('the shell ends', () => run(terminals.find(terminal.id)).info.status === 'exited');
    expect(() => run(terminals.run(terminal.id, 'ls'))).toThrow('That terminal has ended.');
    expect(run(terminals.restart(terminal.id)).status).toBe('running');
    expect(fake.spawned).toHaveLength(2);
    await until(
      'the screen is saved',
      () => run(terminals.select(terminal.id)) !== null && hasScreen(dataDir, terminal.id)
    );
    const viewer = createFakeViewer();
    run(terminals.attach(terminal.id, viewer));
    run(terminals.close(terminal.id));
    expect(viewer.ended).toBe(true);
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(run(terminals.select(terminal.id))).toBeNull();
    expect(hasScreen(dataDir, terminal.id)).toBe(false);
    expect(() => run(terminals.find(terminal.id))).toThrow('That terminal is closed.');
  });

  it('keeps a terminal’s last screen across a restart of the engine, as stopped', async () => {
    const { terminals, fake, dataDir } = createTerminals();
    const terminal = run(terminals.create(START));
    fake.spawned[0]?.emit('dev server on :3000\r\n');
    await runAsync(terminals.stop);
    const again = createTerminals({ dataDir }).terminals;
    const restored = run(again.find(terminal.id));
    expect(restored.info).toMatchObject({ status: 'stopped', endedAt: 100 });
    expect(await runAsync(restored.serializeScreen)).toContain('dev server on :3000');
    expect(run(again.snapshot).terminals).toHaveLength(1);
  });

  it('marks a terminal still running in the saved list as stopped when the engine comes back', () => {
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
    const { terminals } = createTerminals({ dataDir });
    expect(run(terminals.snapshot).terminals.map((each) => [each.id, each.status, each.endedAt])).toEqual([
      ['kept', 'stopped', 100],
      ['done', 'exited', 5],
    ]);
  });

  it('starts with no terminals when the saved list cannot be read', () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(join(dataDir, 'terminals/terminals.json'), '{');
    const logs = captureLogs();
    expect(run(createTerminals({ dataDir }).terminals.snapshot).terminals).toEqual([]);
    logs.restore();
    expect(logs.fieldsOf('[Terminals] Could not read the saved terminals')).toHaveLength(1);
    writeFileSync(join(dataDir, 'terminals/terminals.json'), 'null');
    expect(run(createTerminals({ dataDir }).terminals.snapshot).terminals).toEqual([]);
  });

  it('refuses more terminals than the limit, and any change while Shinsa only shows saved state', () => {
    const { terminals } = createTerminals();
    for (let index = 0; index < TERMINAL_LIMITS.terminals; index++) run(terminals.create(START));
    expect(() => run(terminals.create(START))).toThrow(
      `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run. ${TERMINAL_LIMITS.terminals} are yours. Stop a service or close a terminal to free one.`
    );
    expect(run(terminals.snapshot).terminals).toHaveLength(TERMINAL_LIMITS.terminals);
    const readOnly = createTerminals({ readOnly: true }).terminals;
    expect(() => run(readOnly.create(START))).toThrow('Terminals are off');
  });

  it('says what runs in a shell in front of it, and nothing for an ended one', async () => {
    const { terminals, fake } = createTerminals();
    const terminal = run(terminals.create(START));
    expect(await runAsync(terminals.readForeground(terminal.id))).toEqual({ program: 'vim' });
    fake.spawned[0]?.exit(0);
    await until('the shell ends', () => run(terminals.find(terminal.id)).info.status === 'exited');
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
    const { terminals, fake, dataDir } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    expect(service).toEqual({ id: 'term-1', projectId: 'p1', ...SERVICE });
    expect(JSON.parse(readFileSync(join(dataDir, 'terminals/services.json'), 'utf8')).services).toEqual([
      service,
    ]);
    const terminal = run(terminals.startService(service.id, main('repository')));
    expect(terminal).toMatchObject({
      serviceId: service.id,
      name: 'api',
      cwd: SERVICE.cwd,
      status: 'running',
    });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l', '-c', 'bun run dev']);
    expect(fake.spawned[0]?.options.env).toMatchObject({ PORT: '4000', PATH: '/bin' });
    expect(run(terminals.startService(service.id, main('repository'))).id).toBe(terminal.id);
    expect(fake.spawned).toHaveLength(1);
    expect(await runAsync(terminals.readForeground(terminal.id))).toEqual({ program: 'api' });
    await runAsync(terminals.stopService(service.id, null));
    expect(run(terminals.find(terminal.id)).info.status).toBe('stopped');
    expect(fake.spawned[0]?.hungUp).toBe(true);
    run(terminals.startService(service.id, main('folder')));
    expect(run(terminals.find(terminal.id)).info).toMatchObject({ status: 'running', place: 'folder' });
    expect(fake.spawned).toHaveLength(2);
  });

  it('reads the last lines a service printed, and nothing for one that has not run', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 10))).toEqual([]);
    run(terminals.startService(service.id, main('repository')));
    fake.spawned[0]?.emit('listening on 4000\r\nready\r\n');
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 1))).toEqual(['ready']);
    expect(await runAsync(terminals.readServiceOutput(service.id, null, 10))).toEqual([
      'listening on 4000',
      'ready',
    ]);
  });

  it('restarts a running service, stopping it first, and starts a stopped one', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    await runAsync(terminals.restartService(service.id, main('repository')));
    expect(fake.spawned).toHaveLength(1);
    const again = await runAsync(terminals.restartService(service.id, main('repository')));
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(again.status).toBe('running');
    fake.spawned[1]?.exit(1);
    await until('it fails', () => run(terminals.find(again.id)).info.exitCode === 1);
    expect(run(terminals.find(again.id)).info.status).toBe('exited');
  });

  it('renames a service’s terminal with it, and removing it closes the terminal', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    run(terminals.updateService(service.id, { ...SERVICE, name: 'backend' }));
    const terminal = run(terminals.startService(service.id, main('repository')));
    expect(terminal.name).toBe('backend');
    run(terminals.updateService(service.id, { ...SERVICE, name: 'server', command: 'bun start' }));
    expect(run(terminals.find(terminal.id)).info.name).toBe('server');
    run(terminals.removeServices([service.id]));
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(run(terminals.snapshot)).toMatchObject({ services: [], terminals: [] });
    expect(() => run(terminals.findService(service.id))).toThrow('That service is not there anymore.');
    run(terminals.removeServices([run(terminals.addService('p1', SERVICE)).id]));
    await runAsync(terminals.stopService(run(terminals.addService('p1', SERVICE)).id, null));
  });

  it('starts again the services that ran when the engine stopped, where their folder still is', async () => {
    const { terminals, dataDir } = createTerminals();
    const kept = run(terminals.addService('p1', SERVICE));
    const moved = run(terminals.addService('p1', { ...SERVICE, name: 'web', cwd: '/elsewhere' }));
    const idle = run(terminals.addService('p1', { ...SERVICE, name: 'docs' }));
    run(terminals.startService(kept.id, main('repository')));
    run(terminals.startService(moved.id, main('repository', '/elsewhere')));
    run(terminals.startService(idle.id, main('repository')));
    await runAsync(terminals.stopService(idle.id, null));
    run(terminals.create(START));
    await runAsync(terminals.stop);
    const again = createTerminals({ dataDir });
    run(again.terminals.resumeServices(STATE));
    expect(again.fake.spawned.map((each) => each.options.cwd)).toEqual([SERVICE.cwd]);
    expect(run(again.terminals.snapshot).terminals.map((each) => each.status)).toEqual([
      'running',
      'stopped',
      'stopped',
      'stopped',
    ]);
    run(again.terminals.resumeServices(STATE));
    expect(again.fake.spawned).toHaveLength(1);
    const readOnly = createTerminals({ dataDir, readOnly: true });
    run(readOnly.terminals.resumeServices(STATE));
    expect(readOnly.fake.spawned).toHaveLength(0);
  });

  it('runs a service for a task beside its main run, each in a tab of its own', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    const onMain = run(terminals.startService(service.id, main('repository')));
    const forTask = run(
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
    expect(run(terminals.find(forTask.id)).info.status).toBe('stopped');
    expect(run(terminals.find(onMain.id)).info.status).toBe('running');
    run(terminals.updateService(service.id, { ...SERVICE, name: 'backend' }));
    expect([onMain.id, forTask.id].map((id) => run(terminals.find(id)).info.name)).toEqual([
      'backend',
      'backend',
    ]);
    run(terminals.removeServices([service.id]));
    expect(run(terminals.snapshot).terminals).toEqual([]);
  });

  it('closes a task’s service runs and ended shells, and leaves its running shells and other runs alone', async () => {
    const { terminals, fake } = createTerminals();
    const seen: TerminalsSnapshot[] = [];
    run(Effect.asVoid(terminals.subscribe((snapshot) => seen.push(snapshot))));
    const service = run(terminals.addService('p1', SERVICE));
    run(terminals.startService(service.id, main('repository')));
    run(terminals.startService(service.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    run(terminals.startService(service.id, { cwd: '/wt/b', place: 'worktree', taskId: 'b' }));
    const shell = run(terminals.create({ ...START, cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    const ended = run(terminals.create({ ...START, cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    fake.spawned[4]?.exit(0);
    await until('the shell ends', () => run(terminals.find(ended.id)).info.status === 'exited');
    const before = seen.length;
    run(terminals.closeTaskTerminals('a'));
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(run(terminals.snapshot).terminals.map((each) => [each.taskId, each.serviceId])).toEqual([
      [null, service.id],
      ['b', service.id],
      ['a', null],
    ]);
    expect(seen.length).toBe(before + 1);
    run(terminals.closeTaskTerminals('gone'));
    expect(seen.length).toBe(before + 1);
    expect(run(terminals.find(shell.id)).info.status).toBe('running');
    expect(run(terminals.listTerminalPids)).toEqual([1003]);
    expect(run(terminals.listServiceProcesses)).toEqual([{ taskId: 'b', pid: 1002 }]);
  });

  it('starts a task’s run again after a restart only while the task is open', async () => {
    const { terminals, dataDir } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    for (const taskId of ['open', 'merged', 'gone'])
      run(terminals.startService(service.id, { cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    await runAsync(terminals.stop);
    const state = {
      ...STATE,
      tasks: {
        open: { id: 'open', stage: 'building', repoId: 'web', worktreePath: '/wt/open' },
        merged: { id: 'merged', stage: 'merged', repoId: 'web', worktreePath: '/wt/merged' },
      },
    } as unknown as ShinsaState;
    const again = createTerminals({ dataDir });
    await runAsync(again.terminals.resumeServices(state));
    expect(again.fake.spawned.map((each) => each.options.cwd)).toEqual(['/wt/open/apps/api']);
  });

  it('drops the ended terminals of finished and unknown tasks on start, and keeps yours and open tasks’', async () => {
    const { terminals, dataDir } = createTerminals();
    for (const taskId of ['open', 'merged', 'done', 'cancelled', 'gone'])
      run(terminals.create({ ...START, cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    run(terminals.create(START));
    await runAsync(terminals.stop);
    const stages = { open: 'building', merged: 'merged', done: 'done', cancelled: 'cancelled' };
    const state = {
      ...STATE,
      tasks: Object.fromEntries(Object.entries(stages).map(([id, stage]) => [id, { id, stage }])),
    } as unknown as ShinsaState;
    const again = createTerminals({ dataDir });
    const seen: TerminalsSnapshot[] = [];
    run(Effect.asVoid(again.terminals.subscribe((snapshot) => seen.push(snapshot))));
    await runAsync(again.terminals.resumeServices(state));
    expect(run(again.terminals.snapshot).terminals.map((each) => each.taskId)).toEqual(['open', null]);
    const before = seen.length;
    await runAsync(again.terminals.resumeServices(state));
    expect(seen.length).toBe(before);
    const reread = createTerminals({ dataDir });
    expect(run(reread.terminals.snapshot).terminals.map((each) => each.taskId)).toEqual(['open', null]);
  });

  it('forgets the service of a saved terminal whose service is gone', () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(
      join(dataDir, 'terminals/terminals.json'),
      JSON.stringify({ terminals: [createInfo({ id: 'orphan', serviceId: 'gone' })] })
    );
    writeFileSync(join(dataDir, 'terminals/services.json'), '{');
    const logs = captureLogs();
    const { terminals } = createTerminals({ dataDir });
    logs.restore();
    expect(logs.fieldsOf('[Terminals] Could not read the saved services')).toHaveLength(1);
    expect(run(terminals.snapshot).terminals[0]).toMatchObject({ serviceId: null, status: 'stopped' });
  });

  it('adds the address a running service is reached at from elsewhere, publishes it again when asked, and never saves it', async () => {
    const { terminals, dataDir } = createTerminals();
    const service = run(terminals.addService('p1', { ...SERVICE, previewUrl: 'http://localhost:{port}/' }));
    const terminal = run(terminals.startService(service.id, main('repository')));
    run(terminals.create(START));
    let address = 'https://one.shinsa.page/';
    const asked: string[] = [];
    const published: TerminalsSnapshot[] = [];
    run(Effect.asVoid(terminals.subscribe((snapshot) => published.push(snapshot))));
    const changed = new Set<() => void>();
    run(
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
    const { terminals, fake } = createTerminals();
    const preview = { ...SERVICE, previewUrl: 'http://localhost:{port}/tasks', portVariable: 'APP_PORT' };
    const service = run(terminals.addService('p1', preview));
    const runFor = (taskId: string) =>
      run(terminals.startService(service.id, { cwd: `/wt/${taskId}`, place: 'worktree', taskId }));
    const [a, b] = [runFor('a'), runFor('b')];
    expect([a.port, b.port]).toEqual([5001, 5002]);
    expect(fake.spawned.map((each) => each.options.env.APP_PORT)).toEqual(['5001', '5002']);
    expect(fake.spawned[0]?.options.env.PORT).toBe('4000');
    await runAsync(terminals.stopService(service.id, 'a'));
    runFor('c');
    expect(run(terminals.find(a.id)).info.port).toBe(5001);
    expect(runFor('a').port).toBe(5003);
  });

  it('gives a task run its own variables, under the service’s, and keeps them across a restart', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(
      terminals.addService('p1', {
        ...SERVICE,
        env: { PORT: '4000', TURBO_CACHE_DIR: '/mine' },
      })
    );
    const plain = run(terminals.addService('p1', { ...SERVICE, name: 'api', env: {} }));
    const forTask = {
      cwd: '/wt/a',
      place: 'worktree',
      taskId: 'a',
      env: { TURBO_CACHE_DIR: '/shared', A: '1' },
    } as const;
    run(terminals.startService(plain.id, forTask));
    expect(fake.spawned[0]?.options.env).toMatchObject({ TURBO_CACHE_DIR: '/shared', A: '1' });
    run(terminals.startService(service.id, forTask));
    expect(fake.spawned[1]?.options.env).toMatchObject({ TURBO_CACHE_DIR: '/mine', A: '1' });
    await runAsync(terminals.restartService(plain.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }));
    expect(fake.spawned[2]?.options.env.TURBO_CACHE_DIR).toBeUndefined();
  });

  it('keeps a task run’s port across a restart while no other run holds it', async () => {
    const { terminals } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    const forTask = { cwd: '/wt/a', place: 'worktree', taskId: 'a' } as const;
    const first = run(terminals.startService(service.id, forTask));
    expect((await runAsync(terminals.restartService(service.id, forTask))).port).toBe(first.port);
  });

  it('leaves your run’s port to its command unless the service has a preview URL', () => {
    const { terminals, fake } = createTerminals();
    const plain = run(terminals.addService('p1', { ...SERVICE, env: {} }));
    expect(run(terminals.startService(plain.id, main('repository'))).port).toBeNull();
    expect(fake.spawned[0]?.options.env.PORT).toBeUndefined();
    const fixed = run(
      terminals.addService('p1', {
        ...SERVICE,
        name: 'web',
        previewUrl: 'http://localhost:{port}',
      })
    );
    expect(run(terminals.startService(fixed.id, main('repository'))).port).toBe(4000);
    expect(fake.spawned[1]?.options.env.PORT).toBe('4000');
    const picked = run(
      terminals.addService('p1', {
        ...SERVICE,
        name: 'docs',
        env: {},
        previewUrl: 'http://localhost:{port}',
      })
    );
    expect(run(terminals.startService(picked.id, main('repository'))).port).toBe(5001);
    expect(fake.spawned[2]?.options.env.PORT).toBe('5001');
  });

  it('says so when the machine has no free port for a task’s run', async () => {
    const { terminals, fake } = createTerminals({
      pty: {
        readForeground: () => Effect.succeed(null),
        pickPort: () => Effect.fail(new PortUnavailable({ message: 'No free port for the service.' })),
      },
    });
    const service = run(terminals.addService('p1', { ...SERVICE, previewUrl: 'http://localhost:{port}' }));
    const failure = await runAsync(
      Effect.flip(terminals.startService(service.id, { cwd: '/wt/a', place: 'worktree', taskId: 'a' }))
    );
    expect(failure).toMatchObject({
      code: 'service_port_unavailable',
      message: 'No free port for the service.',
    });
    expect(fake.spawned).toHaveLength(0);
  });

  it('refuses more services than the limit', () => {
    const { terminals } = createTerminals();
    for (let index = 0; index < SERVICE_LIMITS.services; index++) run(terminals.addService('p1', SERVICE));
    expect(() => run(terminals.addService('p1', SERVICE))).toThrow('services at most.');
    expect(() => run(createTerminals({ readOnly: true }).terminals.addService('p1', SERVICE))).toThrow(
      'Terminals are off'
    );
  });
});

describe('parseStoredService', () => {
  const service = { id: 's1', projectId: 'p1', ...SERVICE };

  it('keeps only well-formed services', () => {
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

  it('reads a service saved before previews with none, on PORT', () => {
    const { previewUrl, portVariable, ...saved } = service;
    expect(parseStoredService(saved)).toEqual({ ...saved, previewUrl: null, portVariable: 'PORT' });
  });
});

describe('parseStoredTerminal', () => {
  it('keeps only well-formed terminals', () => {
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

  it('reads a terminal saved before services as a shell of its own', () => {
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
  it('publishes changes after 50 ms, saves screens every 2 s and names terminals with UUIDv7 ids', () => {
    const { timings, id } = run(
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
    const { terminals, fake } = createTerminals({ now: () => clock, tasks: TASKS });
    const service = run(terminals.addService('p1', SERVICE));
    const ending = [
      run(terminals.create(START)),
      run(terminals.create({ ...START, taskId: 'open' })),
      run(terminals.startService(service.id, { ...main('repository'), taskId: 'open' })),
      run(terminals.create({ ...START, taskId: 'gone' })),
      run(terminals.create({ ...START, taskId: 'done' })),
    ];
    for (const [index, terminal] of ending.entries()) {
      clock = 200 - index;
      if (terminal.serviceId) await runAsync(terminals.stopService(service.id, 'open'));
      else fake.spawned[index]?.exit(0);
      await until('it ends', () => run(terminals.find(terminal.id)).info.status !== 'running');
    }
    while (run(terminals.snapshot).terminals.length < TERMINAL_LIMITS.terminals) run(terminals.create(START));
    const [yours, taskShell, stopped, gone, done] = ending.map((terminal) => terminal.id);
    const left = () => run(terminals.snapshot).terminals.map((terminal) => terminal.id);
    for (const reclaimed of [done, gone, stopped, taskShell, yours]) {
      run(terminals.create(START));
      expect(left()).not.toContain(reclaimed);
      expect(left()).toHaveLength(TERMINAL_LIMITS.terminals);
    }
    expect(left()).toEqual(expect.not.arrayContaining(ending.map((terminal) => terminal.id)));
    expect(() => run(terminals.create(START))).toThrow('all of them run.');
    await runAsync(terminals.stop);
  });

  it('starts a service in a full list by closing an ended terminal', async () => {
    const { terminals, fake } = createTerminals();
    const service = run(terminals.addService('p1', SERVICE));
    const ended = run(terminals.create(START));
    fake.spawned[0]?.exit(1);
    await until('the shell ends', () => run(terminals.find(ended.id)).info.status === 'exited');
    while (run(terminals.snapshot).terminals.length < TERMINAL_LIMITS.terminals) run(terminals.create(START));
    const started = run(terminals.startService(service.id, { ...main('repository'), taskId: 'open' }));
    expect(started.status).toBe('running');
    expect(run(terminals.snapshot).terminals.map((terminal) => terminal.id)).not.toContain(ended.id);
    await runAsync(terminals.stop);
  });

  it('names the tasks and services that hold every running terminal when it refuses', async () => {
    const { terminals } = createTerminals({ tasks: TASKS });
    const seeded = run(terminals.addService('p1', { ...SERVICE, name: 'seeded' }));
    const sandbox = run(terminals.addService('p1', { ...SERVICE, name: 'sandbox' }));
    run(terminals.startService(seeded.id, { ...main('repository'), taskId: 'open' }));
    run(terminals.startService(sandbox.id, { ...main('repository'), taskId: 'open' }));
    run(terminals.create({ ...START, taskId: 'open' }));
    run(terminals.create({ ...START, taskId: 'gone' }));
    run(terminals.create({ ...START, taskId: 'gone' }));
    run(terminals.create(START));
    while (run(terminals.snapshot).terminals.length < TERMINAL_LIMITS.terminals - 1)
      run(terminals.create(START));
    run(terminals.create({ ...START, taskId: 'done' }));
    expect(() => run(terminals.create(START))).toThrow(
      `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run. LOC-169 runs seeded, sandbox, and a shell. Another task runs 2 shells. LOC-28 runs a shell. ${TERMINAL_LIMITS.terminals - 6} are yours. Stop a service or close a terminal to free one.`
    );
    await runAsync(terminals.stop);
  });

  it('counts a single terminal of yours in the singular', async () => {
    const { terminals } = createTerminals({ tasks: TASKS });
    run(terminals.create(START));
    while (run(terminals.snapshot).terminals.length < TERMINAL_LIMITS.terminals)
      run(terminals.create({ ...START, taskId: 'open' }));
    expect(() => run(terminals.create(START))).toThrow(
      `all of them run. LOC-169 runs ${TERMINAL_LIMITS.terminals - 1} shells. 1 is yours.`
    );
    await runAsync(terminals.stop);
  });

  it('keeps a service that waits to resume after a restart, and closes an ended shell instead', async () => {
    const dataDir = createTempDir();
    const first = createTerminals({ dataDir }).terminals;
    const service = run(first.addService('p1', SERVICE));
    const waiting = run(first.startService(service.id, { ...main('repository'), taskId: 'open' }));
    while (run(first.snapshot).terminals.length < TERMINAL_LIMITS.terminals) run(first.create(START));
    await runAsync(first.stop);
    const again = createTerminals({ dataDir, idPrefix: 'fresh' }).terminals;
    run(again.create(START));
    const left = run(again.snapshot).terminals.map((terminal) => terminal.id);
    expect(left).toContain(waiting.id);
    expect(left).toContain('fresh-1');
    expect(left).toHaveLength(TERMINAL_LIMITS.terminals);
  });
});
