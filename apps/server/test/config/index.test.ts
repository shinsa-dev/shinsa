import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT, resolveConfig, resolvePort } from '../../src/config/index.ts';
import { createTempDir } from '../helpers/index.ts';

describe('resolveConfig', () => {
  test('reads every setting from the environment and creates the data directories', () => {
    const dataDir = join(createTempDir(), 'data');
    const config = resolveConfig({
      HOME: '/home/me',
      SHINSA_DATA_DIR: dataDir,
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
      dataDir,
      databasePath: join(dataDir, 'shinsa.sqlite'),
      port: 5190,
      hostname: 'shinsa.local',
      inspect: true,
      editor: 'zed',
      terminal: 'Ghostty',
      settleDelayMs: 10,
    });
    expect(config.allowedHosts).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      'shinsa.local',
      'box.tail.net',
      'other.lan',
    ]);
    expect(config.roots.slice(0, 3)).toEqual(['/work', '/more', '/home/me/Developer/Projects']);
    for (const dir of [config.worktreesDir, config.evidenceDir, config.transcriptsDir])
      expect(existsSync(dir)).toBe(true);
    expect(config.pluginDir.endsWith('apps/server/plugin')).toBe(true);
    expect(config.webDir.endsWith('apps/web/dist')).toBe(true);
  });

  test('defaults to the loopback address, and a wildcard host adds no allowed name', () => {
    const dataDir = join(createTempDir(), 'data');
    const config = resolveConfig({
      SHINSA_DATA_DIR: dataDir,
      SHINSA_HOST: '0.0.0.0',
      SHINSA_WORKTREES_DIR: join(dataDir, 'wt'),
    });
    expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(config.worktreesDir).toBe(join(dataDir, 'wt'));
    expect(config).toMatchObject({
      port: DEFAULT_PORT,
      inspect: false,
      editor: null,
      terminal: 'Terminal',
      settleDelayMs: 15_000,
    });
    expect(resolveConfig({ SHINSA_DATA_DIR: dataDir }).hostname).toBe('127.0.0.1');
  });

  test('without SHINSA_DATA_DIR the data lives in ~/.shinsa', () => {
    const home = createTempDir();
    const config = resolveConfig({ HOME: home });
    expect(config.dataDir).toBe(join(home, '.shinsa'));
    expect(config.roots[0]).toBe(join(home, 'Developer/Projects'));
    expect(resolveConfig({ HOME: '', SHINSA_DATA_DIR: join(home, 'd') }).roots[0]).toBe(
      join(homedir(), 'Developer/Projects')
    );
  });
});

describe('resolvePort', () => {
  test('rejects anything that is not a port', () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
    expect(resolvePort({ SHINSA_PORT: '' })).toBe(DEFAULT_PORT);
    expect(() => resolvePort({ SHINSA_PORT: 'abc' })).toThrow('SHINSA_PORT must be a whole number');
    expect(() => resolvePort({ SHINSA_PORT: '-1' })).toThrow('whole number');
    expect(() => resolvePort({ SHINSA_PORT: '70000' })).toThrow('must be a port number');
  });
});
