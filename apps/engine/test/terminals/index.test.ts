import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_LIMITS, type ShinsaState, TERMINAL_LIMITS, type TerminalsSnapshot } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { Terminals, type TerminalsOptions } from '../../src/terminals/index.ts';
import { TYPE_LIMITS } from '../../src/terminals/session.ts';
import { parseStoredService, parseStoredTerminal } from '../../src/terminals/store.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createFakeSpawner, createFakeViewer, createInfo } from './fakes.ts';

const START = { projectId: 'p1', cwd: '/code/web', place: 'repository', taskId: null } as const;

function createTerminals(options: Partial<TerminalsOptions> = {}) {
  const dataDir = options.dataDir ?? createTempDir();
  const fake = createFakeSpawner();
  let id = 0;
  const terminals = new Terminals({
    dataDir,
    home: '/home/ada',
    version: '1.0.0',
    env: { SHELL: '/bin/fish', PATH: '/bin' },
    spawn: fake.spawn,
    readForeground: () => Promise.resolve('vim'),
    now: () => 100,
    newId: () => `term-${++id}`,
    notifyMs: 1,
    screenMs: 1,
    ...options,
  });
  return { terminals, fake, dataDir };
}

describe('Terminals', () => {
  it('opens your login shell in the folder, with the terminal’s environment', () => {
    const { terminals, fake } = createTerminals();
    const terminal = terminals.create(START);
    expect(terminal).toMatchObject({ id: 'term-1', cwd: '/code/web', status: 'running', startedAt: 100 });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l']);
    expect(fake.spawned[0]?.options.env).toMatchObject({
      TERM_PROGRAM: 'Shinsa',
      TERM_PROGRAM_VERSION: '1.0.0',
    });
    expect(terminals.snapshot()).toEqual({ terminals: [terminal], services: [], home: '/home/ada' });
  });

  it('tells its listeners and saves the list on every change', async () => {
    const { terminals, dataDir } = createTerminals();
    const seen: TerminalsSnapshot[] = [];
    const stop = terminals.subscribe((snapshot) => seen.push(snapshot));
    const first = terminals.create(START);
    terminals.rename(first.id, '  Server  ');
    expect(seen.at(-1)?.terminals[0]?.name).toBe('Server');
    terminals.rename(first.id, '   ');
    expect(terminals.find(first.id).info.name).toBeNull();
    terminals.rename(first.id, 'x'.repeat(80));
    expect(terminals.find(first.id).info.name).toHaveLength(TERMINAL_LIMITS.name);
    const saved = JSON.parse(readFileSync(join(dataDir, 'terminals/terminals.json'), 'utf8'));
    expect(saved.terminals[0].id).toBe(first.id);
    stop();
    terminals.rename(first.id, null);
    expect(seen.at(-1)?.terminals[0]?.name).toHaveLength(TERMINAL_LIMITS.name);
    await terminals.stop();
  });

  it('puts a project’s terminals in the order you give, leaving other projects where they are', () => {
    const { terminals } = createTerminals();
    const a = terminals.create(START);
    const other = terminals.create({ ...START, projectId: 'p2' });
    const b = terminals.create(START);
    const c = terminals.create(START);
    terminals.reorder('p1', [c.id, 'unknown', a.id]);
    expect(terminals.snapshot().terminals.map((each) => each.id)).toEqual([c.id, other.id, a.id, b.id]);
  });

  it('types into a shell that never goes quiet once the wait is over, and never into one that ended', async () => {
    const saved = TYPE_LIMITS.waitMs;
    TYPE_LIMITS.waitMs = 200;
    try {
      const { terminals, fake } = createTerminals();
      const silent = terminals.create(START);
      terminals.run(silent.id, 'ls');
      await until('typed after the wait', () => fake.spawned[0]?.written.length === 2);
      expect(fake.spawned[0]?.written).toEqual(['ls', '\r']);
      const ending = terminals.create(START);
      terminals.run(ending.id, 'ls');
      fake.spawned[1]?.exit(0);
      await Bun.sleep(400);
      expect(fake.spawned[1]?.written).toEqual([]);
    } finally {
      TYPE_LIMITS.waitMs = saved;
    }
  });

  it('runs a command you asked for, starts an ended shell again and closes one for good', async () => {
    const { terminals, fake, dataDir } = createTerminals();
    const terminal = terminals.create(START);
    terminals.run(terminal.id, 'bun dev');
    expect(fake.spawned[0]?.written).toEqual([]);
    fake.spawned[0]?.emit('~ ⟩ ');
    await until('the command is typed', () => fake.spawned[0]?.written.length === 2);
    expect(fake.spawned[0]?.written).toEqual(['bun dev', '\r']);
    expect(terminals.restart(terminal.id).status).toBe('running');
    expect(fake.spawned).toHaveLength(1);
    fake.spawned[0]?.emit('output');
    fake.spawned[0]?.exit(0);
    await until('the shell ends', () => terminals.find(terminal.id).info.status === 'exited');
    expect(() => terminals.run(terminal.id, 'ls')).toThrow('That terminal has ended. Start it again first.');
    expect(terminals.restart(terminal.id).status).toBe('running');
    expect(fake.spawned).toHaveLength(2);
    await until(
      'the screen is saved',
      () => terminals.select(terminal.id) !== null && hasScreen(dataDir, terminal.id)
    );
    const viewer = createFakeViewer();
    terminals.attach(terminal.id, viewer);
    terminals.close(terminal.id);
    expect(viewer.ended).toBe(true);
    expect(fake.spawned[1]?.hungUp).toBe(true);
    expect(terminals.select(terminal.id)).toBeNull();
    expect(hasScreen(dataDir, terminal.id)).toBe(false);
    expect(() => terminals.find(terminal.id)).toThrow('That terminal is closed.');
  });

  it('keeps a terminal’s last screen across a restart of the engine, as stopped', async () => {
    const { terminals, fake, dataDir } = createTerminals();
    const terminal = terminals.create(START);
    fake.spawned[0]?.emit('dev server on :3000\r\n');
    await terminals.stop();
    const again = createTerminals({ dataDir }).terminals;
    const restored = again.find(terminal.id);
    expect(restored.info).toMatchObject({ status: 'stopped', endedAt: 100 });
    expect(await restored.serializeScreen()).toContain('dev server on :3000');
    expect(again.snapshot().terminals).toHaveLength(1);
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
    expect(terminals.snapshot().terminals.map((each) => [each.id, each.status, each.endedAt])).toEqual([
      ['kept', 'stopped', 100],
      ['done', 'exited', 5],
    ]);
  });

  it('starts with no terminals when the saved list cannot be read', () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(join(dataDir, 'terminals/terminals.json'), '{');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    expect(createTerminals({ dataDir }).terminals.snapshot().terminals).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    writeFileSync(join(dataDir, 'terminals/terminals.json'), 'null');
    expect(createTerminals({ dataDir }).terminals.snapshot().terminals).toEqual([]);
  });

  it('refuses more terminals than the limit, and any change while Shinsa only shows saved state', () => {
    const { terminals } = createTerminals();
    for (let index = 0; index < TERMINAL_LIMITS.terminals; index++) terminals.create(START);
    expect(() => terminals.create(START)).toThrow('Close one to open another.');
    const readOnly = createTerminals({ readOnly: true }).terminals;
    expect(() => readOnly.create(START)).toThrow('Terminals are off');
  });

  it('says what runs in a shell in front of it, and nothing for an ended one', async () => {
    const { terminals, fake } = createTerminals();
    const terminal = terminals.create(START);
    expect(await terminals.readForeground(terminal.id)).toEqual({ program: 'vim' });
    fake.spawned[0]?.exit(0);
    await until('the shell ends', () => terminals.find(terminal.id).info.status === 'exited');
    expect(await terminals.readForeground(terminal.id)).toEqual({ program: null });
  });

  it('reads your environment from the engine when it is given none', () => {
    const { terminals, fake } = createTerminals({ env: undefined });
    terminals.create(START);
    expect(fake.spawned[0]?.options.env.PATH).toBe(process.env.PATH ?? '');
  });
});

const STATE = {
  repos: { web: { id: 'web', name: 'web', path: '/code/web', projectId: 'p1' } },
  projects: { p1: { id: 'p1', name: 'Shop', folders: [] } },
  tasks: {},
} as unknown as ShinsaState;

const SERVICE = { name: 'api', cwd: '/code/web/apps/api', command: 'bun run dev', env: { PORT: '4000' } };

describe('Terminals services', () => {
  it('runs a service’s command in your login shell, with its variables, in a terminal of its own', async () => {
    const { terminals, fake, dataDir } = createTerminals();
    const service = terminals.addService('p1', SERVICE);
    expect(service).toEqual({ id: 'term-1', projectId: 'p1', ...SERVICE });
    expect(JSON.parse(readFileSync(join(dataDir, 'terminals/services.json'), 'utf8')).services).toEqual([
      service,
    ]);
    const terminal = terminals.startService(service.id, 'repository');
    expect(terminal).toMatchObject({
      serviceId: service.id,
      name: 'api',
      cwd: SERVICE.cwd,
      status: 'running',
    });
    expect(fake.spawned[0]?.command).toEqual(['/bin/fish', '-l', '-c', 'bun run dev']);
    expect(fake.spawned[0]?.options.env).toMatchObject({ PORT: '4000', PATH: '/bin' });
    expect(terminals.startService(service.id, 'repository').id).toBe(terminal.id);
    expect(fake.spawned).toHaveLength(1);
    expect(await terminals.readForeground(terminal.id)).toEqual({ program: 'api' });
    await terminals.stopService(service.id);
    expect(terminals.find(terminal.id).info.status).toBe('stopped');
    expect(fake.spawned[0]?.hungUp).toBe(true);
    terminals.startService(service.id, 'folder');
    expect(terminals.find(terminal.id).info).toMatchObject({ status: 'running', place: 'folder' });
    expect(fake.spawned).toHaveLength(2);
  });

  it('restarts a running service, stopping it first, and starts a stopped one', async () => {
    const { terminals, fake } = createTerminals();
    const service = terminals.addService('p1', SERVICE);
    await terminals.restartService(service.id, 'repository');
    expect(fake.spawned).toHaveLength(1);
    const again = await terminals.restartService(service.id, 'repository');
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(again.status).toBe('running');
    fake.spawned[1]?.exit(1);
    await until('it fails', () => terminals.find(again.id).info.exitCode === 1);
    expect(terminals.find(again.id).info.status).toBe('exited');
  });

  it('renames a service’s terminal with it, and removing it closes the terminal', async () => {
    const { terminals, fake } = createTerminals();
    const service = terminals.addService('p1', SERVICE);
    terminals.updateService(service.id, { ...SERVICE, name: 'backend' });
    const terminal = terminals.startService(service.id, 'repository');
    expect(terminal.name).toBe('backend');
    terminals.updateService(service.id, { ...SERVICE, name: 'server', command: 'bun start' });
    expect(terminals.find(terminal.id).info.name).toBe('server');
    terminals.removeServices([service.id]);
    expect(fake.spawned[0]?.hungUp).toBe(true);
    expect(terminals.snapshot()).toMatchObject({ services: [], terminals: [] });
    expect(() => terminals.findService(service.id)).toThrow('That service is not there anymore.');
    terminals.removeServices([terminals.addService('p1', SERVICE).id]);
    await terminals.stopService(terminals.addService('p1', SERVICE).id);
  });

  it('starts again the services that ran when the engine stopped, where their folder still is', async () => {
    const { terminals, dataDir } = createTerminals();
    const kept = terminals.addService('p1', SERVICE);
    const moved = terminals.addService('p1', { ...SERVICE, name: 'web', cwd: '/elsewhere' });
    const idle = terminals.addService('p1', { ...SERVICE, name: 'docs' });
    terminals.startService(kept.id, 'repository');
    terminals.startService(moved.id, 'repository');
    terminals.startService(idle.id, 'repository');
    await terminals.stopService(idle.id);
    terminals.create(START);
    await terminals.stop();
    const again = createTerminals({ dataDir });
    again.terminals.resumeServices(STATE);
    expect(again.fake.spawned.map((each) => each.options.cwd)).toEqual([SERVICE.cwd]);
    expect(again.terminals.snapshot().terminals.map((each) => each.status)).toEqual([
      'running',
      'stopped',
      'stopped',
      'stopped',
    ]);
    again.terminals.resumeServices(STATE);
    expect(again.fake.spawned).toHaveLength(1);
    const readOnly = createTerminals({ dataDir, readOnly: true });
    readOnly.terminals.resumeServices(STATE);
    expect(readOnly.fake.spawned).toHaveLength(0);
  });

  it('forgets the service of a saved terminal whose service is gone', () => {
    const dataDir = createTempDir();
    mkdirSync(join(dataDir, 'terminals'));
    writeFileSync(
      join(dataDir, 'terminals/terminals.json'),
      JSON.stringify({ terminals: [createInfo({ id: 'orphan', serviceId: 'gone' })] })
    );
    writeFileSync(join(dataDir, 'terminals/services.json'), '{');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { terminals } = createTerminals({ dataDir });
    warn.mockRestore();
    expect(terminals.snapshot().terminals[0]).toMatchObject({ serviceId: null, status: 'stopped' });
  });

  it('refuses more services than the limit', () => {
    const { terminals } = createTerminals();
    for (let index = 0; index < SERVICE_LIMITS.services; index++) terminals.addService('p1', SERVICE);
    expect(() => terminals.addService('p1', SERVICE)).toThrow('Remove one to add another.');
    expect(() => createTerminals({ readOnly: true }).terminals.addService('p1', SERVICE)).toThrow(
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
  });

  it('reads a terminal saved before services as a shell of its own', () => {
    const { serviceId, ...saved } = createInfo();
    expect(serviceId).toBeNull();
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
