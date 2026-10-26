import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHINSA_APPEARANCE, TERMINAL_LIMITS, type TerminalsSnapshot } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { Terminals, type TerminalsOptions } from '../../src/terminals/index.ts';
import { TYPE_LIMITS } from '../../src/terminals/session.ts';
import { parseStoredTerminal } from '../../src/terminals/store.ts';
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
    appearance: () => ({ ...SHINSA_APPEARANCE, fontFamily: 'Iosevka' }),
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
    expect(terminals.snapshot()).toMatchObject({
      terminals: [terminal],
      appearance: { fontFamily: 'Iosevka' },
    });
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

  it('reads the appearance again when asked, and keeps the last one when reading fails', () => {
    let font = 'Iosevka';
    const { terminals } = createTerminals({
      appearance: () => {
        if (font === 'broken') throw new Error('bad config');
        return { ...SHINSA_APPEARANCE, fontFamily: font };
      },
    });
    font = 'Menlo';
    expect(terminals.snapshot().appearance.fontFamily).toBe('Menlo');
    font = 'broken';
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    expect(terminals.readAppearance()?.fontFamily).toBe('Menlo');
    warn.mockRestore();
  });

  it('falls back to Shinsa’s look when the very first read fails, and reads Ghostty’s files by default', () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const broken = createTerminals({
      appearance: () => {
        throw new Error('bad config');
      },
    }).terminals;
    expect(broken.snapshot().appearance).toEqual(SHINSA_APPEARANCE);
    warn.mockRestore();
    const home = createTempDir();
    const real = createTerminals({ appearance: undefined, env: { HOME: home } }).terminals;
    expect(real.snapshot().appearance.source).toBe('shinsa');
    const process = createTerminals({ appearance: undefined, env: undefined }).terminals;
    expect(process.snapshot().appearance.source).toMatch(/shinsa|ghostty/);
  });
});

describe('parseStoredTerminal', () => {
  it('keeps only well-formed terminals', () => {
    expect(parseStoredTerminal(createInfo())).toEqual(createInfo());
    expect(parseStoredTerminal(null)).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), id: '../x' })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), status: 'paused' })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), name: 3 })).toBeNull();
    expect(parseStoredTerminal({ ...createInfo(), startedAt: '1' })).toBeNull();
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
