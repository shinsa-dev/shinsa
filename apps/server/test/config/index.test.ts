import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigStore,
  DEFAULT_PORT,
  prepareDataDir,
  resolveConfig,
  resolveServerAddress,
  resolveShinsaPaths,
} from '../../src/config/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { commitEvents, createTempDir } from '../helpers/index.ts';

function createLegacyData(dir: string) {
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  const log = new EventLog(join(dir, 'shinsa.sqlite'));
  commitEvents(log, [{ type: 'focus.changed', focus: { projectId: null, until: null } }], [], 0, 1);
  log.close();
  writeFileSync(join(dir, 'transcripts', 'run-1.jsonl'), '{}\n');
}

describe('resolveShinsaPaths', () => {
  test('lives in ~/.config/shinsa, with the data beside config.json, and copies from ~/.shinsa', () => {
    expect(resolveShinsaPaths({ HOME: '/home/me' })).toEqual({
      home: '/home/me/.config/shinsa',
      configPath: '/home/me/.config/shinsa/config.json',
      dataDir: '/home/me/.config/shinsa/data',
      legacyDataDir: '/home/me/.shinsa',
    });
    expect(resolveShinsaPaths({ HOME: '/home/me', XDG_CONFIG_HOME: '/xdg' }).home).toBe('/xdg/shinsa');
    expect(resolveShinsaPaths({}).legacyDataDir).toBe(join(homedir(), '.shinsa'));
  });

  test('SHINSA_HOME moves everything and SHINSA_DATA_DIR keeps the flat layout, neither migrates', () => {
    expect(resolveShinsaPaths({ HOME: '/home/me', SHINSA_HOME: '/tmp/s' })).toEqual({
      home: '/tmp/s',
      configPath: '/tmp/s/config.json',
      dataDir: '/tmp/s/data',
      legacyDataDir: null,
    });
    expect(resolveShinsaPaths({ SHINSA_DATA_DIR: '/seed/data' })).toEqual({
      home: '/seed/data',
      configPath: '/seed/data/config.json',
      dataDir: '/seed/data',
      legacyDataDir: null,
    });
  });
});

describe('resolveConfig', () => {
  test('reads every setting from the environment, which wins over config.json', () => {
    const home = createTempDir();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 6000, hostname: 'box', editor: 'vim' }));
    const config = resolveConfig({
      HOME: '/home/me',
      SHINSA_HOME: home,
      SHINSA_PORT: '5190',
      SHINSA_HOST: 'shinsa.local',
      SHINSA_ALLOWED_HOSTS: 'box.tail.net, other.lan',
      SHINSA_ROOTS: '/work:/more',
      SHINSA_INSPECT: '1',
      SHINSA_EDITOR: 'zed',
      SHINSA_TERMINAL: 'Ghostty',
      SHINSA_SETTLE_DELAY_MS: '10',
    });
    expect(config).toMatchObject({
      home,
      configPath: join(home, 'config.json'),
      dataDir: join(home, 'data'),
      databasePath: join(home, 'data', 'shinsa.sqlite'),
      port: 5190,
      hostname: 'shinsa.local',
      inspect: true,
      editor: 'zed',
      terminal: 'Ghostty',
      settleDelayMs: 10,
      userHome: '/home/me',
      roots: ['/work', '/more'],
    });
    expect(config.allowedHosts).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      'shinsa.local',
      'box.tail.net',
      'other.lan',
    ]);
    expect(existsSync(config.dataDir)).toBe(false);
    expect(config.pluginDir.endsWith('apps/server/plugin')).toBe(true);
    expect(config.webDir.endsWith('apps/web/dist')).toBe(true);
  });

  test('takes the port, host, editor and terminal from config.json when the environment is silent', () => {
    const home = createTempDir();
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ port: 6000, hostname: '0.0.0.0', editor: 'vim', terminal: 'iTerm' })
    );
    const config = resolveConfig({ SHINSA_HOME: home });
    expect(config).toMatchObject({ port: 6000, hostname: '0.0.0.0', editor: 'vim', terminal: 'iTerm' });
    expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  test('reads config.json once and leaves a broken one for the server to keep aside', () => {
    const home = createTempDir();
    writeFileSync(join(home, 'config.json'), '{ broken');
    const config = resolveConfig({ SHINSA_HOME: home });
    expect(config.machine).toMatchObject({
      unreadable: true,
      problems: [expect.stringContaining('not valid JSON')],
    });
    expect(config.port).toBe(DEFAULT_PORT);
    expect(readdirSync(home)).toEqual(['config.json']);
  });

  test('defaults to the loopback address and the standard port', () => {
    const dataDir = join(createTempDir(), 'data');
    const config = resolveConfig({ SHINSA_DATA_DIR: dataDir, SHINSA_WORKTREES_DIR: join(dataDir, 'wt') });
    expect(config.worktreesDir).toBe(join(dataDir, 'wt'));
    expect(config).toMatchObject({
      port: DEFAULT_PORT,
      hostname: '127.0.0.1',
      inspect: false,
      editor: null,
      terminal: 'Terminal',
      settleDelayMs: 15_000,
      roots: [],
    });
  });
});

function prepare(env: Record<string, string>) {
  const config = resolveConfig(env);
  return prepareDataDir(config, new ConfigStore(config.configPath, config.machine));
}

describe('prepareDataDir', () => {
  test('creates the data directories', () => {
    const config = prepare({ SHINSA_HOME: createTempDir() });
    for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir])
      expect(existsSync(dir)).toBe(true);
  });

  test('copies the old ~/.shinsa on first start, records it in config.json and leaves the original', () => {
    const user = createTempDir();
    createLegacyData(join(user, '.shinsa'));
    const config = prepare({ HOME: user });
    expect(config.dataDir).toBe(join(user, '.config', 'shinsa', 'data'));
    expect(readFileSync(join(config.transcriptsDir, 'run-1.jsonl'), 'utf8')).toBe('{}\n');
    const log = new EventLog(config.databasePath);
    expect(log.readEvents().events).toHaveLength(1);
    log.close();
    expect(existsSync(join(user, '.shinsa', 'shinsa.sqlite'))).toBe(true);
    const recorded = JSON.parse(readFileSync(config.configPath, 'utf8'));
    expect(recorded.migratedFrom.path).toBe(join(user, '.shinsa'));
    expect(prepare({ HOME: user }).dataDir).toBe(config.dataDir);
  });

  test('keeps using the old directory when the copy cannot be made', () => {
    const user = createTempDir();
    createLegacyData(join(user, '.shinsa'));
    mkdirSync(join(user, '.config', 'shinsa', 'data'), { recursive: true });
    writeFileSync(join(user, '.config', 'shinsa', 'data', 'stray.txt'), '');
    const config = prepare({ HOME: user });
    expect(config.dataDir).toBe(join(user, '.shinsa'));
    expect(config.worktreesDir).toBe(join(user, '.shinsa', 'worktrees'));
    const custom = prepare({ HOME: user, SHINSA_WORKTREES_DIR: join(user, 'wt') });
    expect(custom.worktreesDir).toBe(join(user, 'wt'));
  });
});

describe('the address the command line reaches the server on', () => {
  test('rejects anything that is not a port', () => {
    const home = createTempDir();
    expect(resolveServerAddress({ SHINSA_HOME: home }).port).toBe(DEFAULT_PORT);
    expect(resolveServerAddress({ SHINSA_HOME: home, SHINSA_PORT: '' }).port).toBe(DEFAULT_PORT);
    expect(() => resolveServerAddress({ SHINSA_HOME: home, SHINSA_PORT: 'abc' })).toThrow(
      'SHINSA_PORT must be a whole number'
    );
    expect(() => resolveServerAddress({ SHINSA_HOME: home, SHINSA_PORT: '-1' })).toThrow('whole number');
    expect(() => resolveServerAddress({ SHINSA_HOME: home, SHINSA_PORT: '70000' })).toThrow(
      'must be a port number'
    );
  });

  test('is the host and port the server is configured on, and loopback when it listens on every address', () => {
    const home = createTempDir();
    expect(resolveServerAddress({ SHINSA_HOME: home })).toEqual({
      hostname: '127.0.0.1',
      port: DEFAULT_PORT,
    });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 5300, hostname: 'shinsa.local' }));
    expect(resolveServerAddress({ SHINSA_HOME: home })).toEqual({ hostname: 'shinsa.local', port: 5300 });
    expect(resolveServerAddress({ SHINSA_HOME: home, SHINSA_HOST: '0.0.0.0' })).toEqual({
      hostname: '127.0.0.1',
      port: 5300,
    });
  });
});

describe('the eunoe settings', () => {
  test('runs the bundled eunoe on a port of its own unless SHINSA_EUNOE and SHINSA_EUNOE_PORT say otherwise', () => {
    const home = createTempDir();
    expect(resolveConfig({ SHINSA_HOME: home }).eunoe).toEqual({ command: null, port: null });
    expect(
      resolveConfig({ SHINSA_HOME: home, SHINSA_EUNOE: '/opt/eunoe', SHINSA_EUNOE_PORT: '38700' }).eunoe
    ).toEqual({ command: '/opt/eunoe', port: 38_700 });
    for (const port of ['0', '70000']) {
      expect(() => resolveConfig({ SHINSA_HOME: home, SHINSA_EUNOE_PORT: port })).toThrow(
        `SHINSA_EUNOE_PORT must be a port number, not "${port}".`
      );
    }
    expect(() => resolveConfig({ SHINSA_HOME: home, SHINSA_EUNOE_PORT: 'next' })).toThrow(
      'SHINSA_EUNOE_PORT must be a whole number'
    );
  });
});
