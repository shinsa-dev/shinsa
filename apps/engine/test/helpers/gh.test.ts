import { describe, expect, test } from 'bun:test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../../src/shell/index.ts';
import { createTempDir } from './index.ts';

const GH_EXIT_MS = 5_000;

function runFakeGh(state: string, args: string[]) {
  return runCommand(['gh', ...args], createTempDir(), {
    env: { FAKE_GH_STATE: state, FAKE_GH_LOGIN: 'octo' },
    timeoutMs: GH_EXIT_MS,
  });
}

describe('the fake gh', () => {
  test('exits with an error, instead of waiting forever, when its state folder is gone', async () => {
    const result = await runFakeGh(join(createTempDir(), 'gone', 'gh.json'), ['api', 'user']);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot lock');
  });

  test('breaks a lock left by a gh that was killed', async () => {
    const state = join(createTempDir(), 'gh.json');
    mkdirSync(`${state}.lock`);
    writeFileSync(join(`${state}.lock`, 'pid'), '999999');
    const result = await runFakeGh(state, ['api', 'user']);
    expect(result).toMatchObject({ ok: true, stdout: 'octo', timedOut: false });
  });

  test('breaks an old lock that names no holder', async () => {
    const state = join(createTempDir(), 'gh.json');
    mkdirSync(`${state}.lock`);
    utimesSync(`${state}.lock`, new Date(0), new Date(0));
    const result = await runFakeGh(state, ['api', 'user']);
    expect(result).toMatchObject({ ok: true, stdout: 'octo', timedOut: false });
  });
});
