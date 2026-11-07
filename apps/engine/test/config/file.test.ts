import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { Effect, Layer } from 'effect';
import { createMachineConfig, parseMachineConfig } from '../../src/config/machine/decode.ts';
import type { MachineConfigRead } from '../../src/config/machine/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ConfigStore } from '../../src/config/store/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createConfigAt, readMachineConfig } from '../helpers/config.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { captureLogs, createTempDir } from '../helpers/index.ts';

async function openStore(path: string, read: MachineConfigRead = readMachineConfig(path)) {
  const config = { ...createConfigAt(dirname(path)), configPath: path, machine: read };
  const store = await Effect.runPromise(
    ConfigStore.pipe(
      Effect.provide(
        ConfigStore.layer.pipe(
          Layer.provide(Layer.mergeAll(Layer.succeed(EngineConfig, config), JsonFileLayer, JsonLogger))
        )
      )
    )
  );
  return {
    path: store.path,
    get config() {
      return Effect.runPromise(store.config);
    },
    update: (patch: Parameters<typeof store.update>[0]) => Effect.runPromise(store.update(patch)),
  };
}

describe('parseMachineConfig', () => {
  test('keeps every valid field', () => {
    const value = {
      roots: ['/a', ' /b ', '/a'],
      onboardedAt: 5,
      port: 5180,
      hostname: 'box',
      editor: 'zed',
      terminal: 'Ghostty',
      worktreesDir: '/Volumes/bucket/worktrees',
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
      worktreesDir: 'worktrees',
    });
    expect(config).toEqual(createMachineConfig());
    expect(problems).toEqual([
      'roots must be a list of folders; it was ignored.',
      'onboardedAt must be a time; it was ignored.',
      'port must be a port number; it was ignored.',
      'hostname must be text; it was ignored.',
      'worktreesDir must be the full path of a folder; it was ignored.',
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
  test('writes atomically, privately, and reads back what it wrote', async () => {
    const path = join(createTempDir(), 'nested', 'config.json');
    const store = await openStore(path);
    expect((await store.config).roots).toEqual([]);
    await store.update({ roots: ['/code'] });
    expect((await store.config).roots).toEqual(['/code']);
    expect((await (await openStore(path)).config).roots).toEqual(['/code']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.writing-${process.pid}`)).toBe(false);
  });

  test('keeps a broken config.json aside once and logs each problem once, from the read it is given', async () => {
    const dir = createTempDir();
    const path = join(dir, 'config.json');
    writeFileSync(path, '{"roots": [');
    const read = readMachineConfig(path);
    const logs = captureLogs();
    try {
      const store = await openStore(path, read);
      expect(await store.config).toEqual(createMachineConfig());
      const copies = readdirSync(dir).filter((name) => name.startsWith('config.json.unreadable-'));
      expect(copies).toHaveLength(1);
      expect(readFileSync(join(dir, copies[0] ?? ''), 'utf8')).toBe('{"roots": [');
      expect(logs.fieldsOf('[Config] Part of config.json was not used')).toEqual([
        { path, problem: read.problems[0], copy: join(dir, copies[0] ?? '') },
      ]);
    } finally {
      logs.restore();
    }
  });

  test('loads a config.json with problems and keeps the good parts', async () => {
    const path = join(createTempDir(), 'config.json');
    writeFileSync(path, JSON.stringify({ roots: ['/code'], port: 'x' }));
    expect(await (await openStore(path)).config).toMatchObject({ roots: ['/code'], port: null });
  });
});
