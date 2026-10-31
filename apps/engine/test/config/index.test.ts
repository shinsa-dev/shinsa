import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';
import {
  prepareDataDir,
  resolveConfig,
  resolveServerAddress,
  resolveShinsaPaths,
} from '../../src/config/index.ts';
import { createTempDir } from '../helpers/index.ts';

const DEFAULT_PORT = APP_IDENTITY.port;

describe('resolveShinsaPaths', () => {
  test('lives in ~/.config/shinsa, with the data beside config.json', () => {
    expect(resolveShinsaPaths({ HOME: '/home/me' })).toEqual({
      home: '/home/me/.config/shinsa',
      configPath: '/home/me/.config/shinsa/config.json',
      dataDir: '/home/me/.config/shinsa/data',
    });
    expect(resolveShinsaPaths({ HOME: '/home/me', XDG_CONFIG_HOME: '/xdg' }).home).toBe('/xdg/shinsa');
    expect(resolveShinsaPaths({}).home).toBe(join(homedir(), '.config', 'shinsa'));
  });

  test('SHINSA_HOME moves everything and SHINSA_DATA_DIR keeps the flat layout', () => {
    expect(resolveShinsaPaths({ HOME: '/home/me', SHINSA_HOME: '/tmp/s' })).toEqual({
      home: '/tmp/s',
      configPath: '/tmp/s/config.json',
      dataDir: '/tmp/s/data',
    });
    expect(resolveShinsaPaths({ SHINSA_DATA_DIR: '/seed/data' })).toEqual({
      home: '/seed/data',
      configPath: '/seed/data/config.json',
      dataDir: '/seed/data',
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
      SHINSA_PUSH_RETRY_MS: '20',
      SHINSA_OVERLOAD_RETRY_MS: '30',
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
      pushRetryMs: 20,
      overloadRetryMs: 30,
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
    expect(config.pluginDir.endsWith('apps/engine/plugin')).toBe(true);
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

  test('SHINSA_WEB_DIR and SHINSA_PLUGIN_DIR serve the web app and load the plugin from elsewhere', () => {
    const config = resolveConfig({
      SHINSA_HOME: createTempDir(),
      SHINSA_WEB_DIR: '/bundle/web',
      SHINSA_PLUGIN_DIR: '/bundle/plugin',
    });
    expect(config).toMatchObject({ webDir: '/bundle/web', pluginDir: '/bundle/plugin' });
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
      pushRetryMs: 30_000,
      overloadRetryMs: 15_000,
      roots: [],
    });
  });

  test('the installed app defaults to 7446, and a dev engine pins 5180 so the two never meet', async () => {
    expect(resolveConfig({ SHINSA_HOME: createTempDir() }, null).port).toBe(7446);
    const { scripts } = await Bun.file(join(import.meta.dir, '../../package.json')).json();
    for (const script of [scripts.dev, scripts.start]) {
      expect(script).toMatch(/^SHINSA_PORT=\$\{SHINSA_PORT:-5180\} /);
    }
    expect(APP_IDENTITY.port).not.toBe(5180);
  });
});

describe('prepareDataDir', () => {
  test('creates the data directories', () => {
    const config = resolveConfig({ SHINSA_HOME: createTempDir() });
    prepareDataDir(config);
    for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir])
      expect(existsSync(dir)).toBe(true);
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
