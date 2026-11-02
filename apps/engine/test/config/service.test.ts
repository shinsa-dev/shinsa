import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { readMachineConfig } from '../../src/config/machine.ts';
import type { Env } from '../../src/config/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { runTest } from '../harness.ts';
import { createTempDir } from '../helpers/index.ts';

function readEngineConfig(env: Env) {
  return Effect.provide(EngineConfig, EngineConfig.layer(env, null));
}

describe('EngineConfig', () => {
  test('reads each setting once from the environment, then config.json, then its default', async () => {
    const home = createTempDir();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ editor: 'vim', terminal: 'iTerm', port: 0 }));
    const fromFile = await runTest(readEngineConfig({ SHINSA_HOME: home }));
    expect(fromFile).toMatchObject({ editor: 'vim', terminal: 'iTerm', port: 0, hostname: '127.0.0.1' });
    const fromEnv = await runTest(
      readEngineConfig({ SHINSA_HOME: home, SHINSA_EDITOR: 'zed', SHINSA_TERMINAL: '', SHINSA_PORT: '5190' })
    );
    expect(fromEnv).toMatchObject({ editor: 'zed', terminal: 'iTerm', port: 5190 });
  });

  test('a setting that is not a whole number fails with SettingInvalid naming it', async () => {
    const error = await runTest(
      Effect.flip(readEngineConfig({ SHINSA_HOME: createTempDir(), SHINSA_PUSH_RETRY_MS: '1.5' }))
    );
    expect(error).toMatchObject({
      _tag: 'SettingInvalid',
      key: 'SHINSA_PUSH_RETRY_MS',
      message: 'SHINSA_PUSH_RETRY_MS must be a whole number, not "1.5".',
    });
    const port = await runTest(
      Effect.flip(readEngineConfig({ SHINSA_HOME: createTempDir(), SHINSA_PORT: '70000' }))
    );
    expect(port).toMatchObject({ _tag: 'SettingInvalid', key: 'SHINSA_PORT' });
  });
});

describe('readMachineConfig', () => {
  test('a config.json that cannot be read is unreadable, like broken JSON', () => {
    const path = join(createTempDir(), 'config.json');
    mkdirSync(path);
    const read = readMachineConfig(path);
    expect(read.unreadable).toBe(true);
    expect(read.problems[0]).toStartWith('The file is not valid JSON (');
  });

  test('editor and terminal must be text', () => {
    const path = join(createTempDir(), 'config.json');
    writeFileSync(path, JSON.stringify({ editor: ' ', terminal: ['x'] }));
    expect(readMachineConfig(path).problems).toEqual([
      'editor must be text; it was ignored.',
      'terminal must be text; it was ignored.',
    ]);
  });
});
