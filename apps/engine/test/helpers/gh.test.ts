import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../../src/shell/index.ts';
import { FakeGitHub } from '../e2e/harness.ts';
import { createTempDir, until } from './index.ts';

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

describe('the fake GitHub a test drives', () => {
  test('a change the test makes while a gh holds the state waits for it, so the gh never writes over it', async () => {
    const state = join(createTempDir(), 'gh.json');
    const github = new FakeGitHub(state);
    const pull = { number: 1, head: 'feat/x', base: 'main', state: 'OPEN', checks: 'pending', unresolved: 0 };
    writeFileSync(state, JSON.stringify({ next: 2, defaultChecks: 'pending', pulls: [pull], calls: [] }));
    const running = runCommand(['gh', 'api', 'user'], createTempDir(), {
      env: { FAKE_GH_STATE: state, FAKE_GH_LOGIN: 'octo', FAKE_GH_HOLD_MS: '300' },
      timeoutMs: GH_EXIT_MS,
    });
    await until('the gh to hold the state', () => existsSync(`${state}.lock`));
    github.update(1, { checks: 'passing' });
    expect(await running).toMatchObject({ ok: true, stdout: 'octo' });
    expect(github.pulls[0]?.checks).toBe('passing');
    expect(github.calls).toEqual([['api', 'user']]);
  });
});
