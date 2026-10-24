import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ConfigStore,
  createMachineConfig,
  parseMachineConfig,
  readMachineConfig,
} from '../../src/config/file.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir } from '../helpers/index.ts';

describe('parseMachineConfig', () => {
  test('keeps every valid field', () => {
    const value = {
      roots: ['/a', ' /b ', '/a'],
      onboardedAt: 5,
      port: 5180,
      hostname: 'box',
      editor: 'zed',
      terminal: 'Ghostty',
      migratedFrom: { path: '/old', at: 3 },
    };
    expect(parseMachineConfig(value)).toEqual({
      config: { version: 1, ...value, roots: ['/a', '/b'] },
      problems: [],
      unreadable: false,
    });
  });

  test('drops what is wrong and names each problem', () => {
    const { config, problems } = parseMachineConfig({
      roots: [1],
      onboardedAt: 'yesterday',
      port: 99_999,
      hostname: 7,
      migratedFrom: { path: '' },
    });
    expect(config).toEqual(createMachineConfig());
    expect(problems).toEqual([
      'roots must be a list of folders; it was ignored.',
      'onboardedAt must be a time; it was ignored.',
      'port must be a port number; it was ignored.',
      'hostname must be text; it was ignored.',
      'migratedFrom is not a migration record; it was ignored.',
    ]);
    expect(parseMachineConfig([]).problems).toEqual(['The file is not a JSON object.']);
    expect(parseMachineConfig(null).config).toEqual(createMachineConfig());
  });
});

describe('readMachineConfig', () => {
  test('a missing file is the defaults, and reading a broken one leaves it alone', () => {
    const dir = createTempDir();
    expect(readMachineConfig(join(dir, 'config.json'))).toEqual({
      config: createMachineConfig(),
      problems: [],
      unreadable: false,
    });
    writeFileSync(join(dir, 'config.json'), '{"roots": [');
    const read = readMachineConfig(join(dir, 'config.json'));
    expect(read.config).toEqual(createMachineConfig());
    expect(read.problems[0]).toStartWith('The file is not valid JSON');
    expect(read.unreadable).toBe(true);
    expect(readdirSync(dir)).toEqual(['config.json']);
  });
});

describe('ConfigStore', () => {
  test('writes atomically, privately, and reads back what it wrote', () => {
    const path = join(createTempDir(), 'nested', 'config.json');
    const store = new ConfigStore(path);
    expect(store.config.roots).toEqual([]);
    store.update({ roots: ['/code'] });
    expect(store.config.roots).toEqual(['/code']);
    expect(new ConfigStore(path).config.roots).toEqual(['/code']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.writing-${process.pid}`)).toBe(false);
  });

  test('keeps a broken config.json aside once and logs each problem once, from the read it is given', () => {
    const dir = createTempDir();
    const path = join(dir, 'config.json');
    writeFileSync(path, '{"roots": [');
    const read = readMachineConfig(path);
    const warn = spyOn(log, 'warn');
    try {
      const store = new ConfigStore(path, read);
      expect(store.config).toEqual(createMachineConfig());
      const copies = readdirSync(dir).filter((name) => name.startsWith('config.json.unreadable-'));
      expect(copies).toHaveLength(1);
      expect(readFileSync(join(dir, copies[0] ?? ''), 'utf8')).toBe('{"roots": [');
      expect(warn.mock.calls).toEqual([
        [
          '[Config] Part of config.json was not used',
          { path, problem: read.problems[0], copy: join(dir, copies[0] ?? '') },
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test('loads a config.json with problems and keeps the good parts', () => {
    const path = join(createTempDir(), 'config.json');
    writeFileSync(path, JSON.stringify({ roots: ['/code'], port: 'x' }));
    expect(new ConfigStore(path).config).toMatchObject({ roots: ['/code'], port: null });
  });
});
