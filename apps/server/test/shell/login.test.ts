import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { applyLoginEnv, createLoginEnvReader, mergePathLists, parseLoginEnv } from '../../src/shell/login.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';

const FAKE_SHELL = resolve(import.meta.dirname, '../helpers/bin/login-shell');

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function withShellEnv(values: Record<string, string>) {
  restores.push(overrideEnv(values));
}

function answer(stdout: string, ok = true): CommandResult {
  return { ok, code: ok ? 0 : 1, stdout, stderr: '', timedOut: false };
}

describe('reading the login shell’s output', () => {
  test('takes every variable after the marker, NUL-separated, whatever the rc files printed first', () => {
    const output = `Welcome!\n__SHINSA_LOGIN_ENV__PATH=/opt/homebrew/bin:/usr/bin\0TOKEN=a=b\0NOTE=line one\nline two\0PWD=/tmp\0SHLVL=2\0_=/usr/bin/env\0=broken\0no-equals\0`;
    expect(parseLoginEnv(output)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      TOKEN: 'a=b',
      NOTE: 'line one\nline two',
    });
  });

  test('without the marker there is nothing to read', () => {
    expect(parseLoginEnv('zsh: command not found: compinit')).toBeNull();
  });

  test('merging PATH keeps the current order first and adds only what is missing', () => {
    expect(mergePathLists('/a:/b', '/b:/c::/a:/d')).toBe('/a:/b:/c:/d');
    expect(mergePathLists('', '/c')).toBe('/c');
  });
});

describe('the login shell environment', () => {
  test('runs the user’s shell as an interactive login shell in their home folder, once', async () => {
    const home = createTempDir();
    const calls = join(home, 'calls.log');
    withShellEnv({ FAKE_LOGIN_SHELL_EXPORT: '1', FAKE_LOGIN_SHELL_LOG: calls });
    const reader = createLoginEnvReader({ SHELL: FAKE_SHELL, HOME: home });
    const [first, second] = await Promise.all([reader.read(), reader.read()]);
    expect(second).toBe(first);
    expect(await reader.read()).toBe(first);
    expect(first).toMatchObject({
      FAKE_LOGIN_VAR: 'from the login shell',
      FAKE_LOGIN_MULTILINE: 'first\nsecond',
    });
    expect(first?.PATH?.split(':')[0]).toBe('/fake/login/bin');
    expect(first).not.toHaveProperty('DISABLE_AUTO_UPDATE');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      "-lic printf '%s' __SHINSA_LOGIN_ENV__; /usr/bin/env -0",
    ]);
  });

  test('defaults to zsh in the home folder of this machine', async () => {
    const runs: { command: string[]; cwd: string }[] = [];
    const reader = createLoginEnvReader(
      {},
      {
        run: (command, cwd) => {
          runs.push({ command, cwd });
          return Promise.resolve(answer('__SHINSA_LOGIN_ENV__A=1\0'));
        },
      }
    );
    expect(await reader.read()).toEqual({ A: '1' });
    expect(runs).toEqual([{ command: expect.arrayContaining(['/bin/zsh', '-lic']), cwd: homedir() }]);
  });

  test('a shell that hangs, fails or is missing gives nothing, and says so', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      withShellEnv({ FAKE_LOGIN_SHELL_HANG: '1' });
      const hung = createLoginEnvReader({ SHELL: FAKE_SHELL, HOME: createTempDir() }, { timeoutMs: 200 });
      expect(await hung.read()).toBeNull();
      expect(warn).toHaveBeenLastCalledWith('[Serve] Could not read the login shell environment', {
        shell: FAKE_SHELL,
        code: expect.any(Number),
        timedOut: true,
      });
      for (const restore of restores.splice(0)) restore();
      withShellEnv({ FAKE_LOGIN_SHELL_SILENT: '1' });
      expect(await createLoginEnvReader({ SHELL: FAKE_SHELL, HOME: createTempDir() }).read()).toBeNull();
      const missing = join(createTempDir(), 'no-such-shell');
      expect(await createLoginEnvReader({ SHELL: missing, HOME: createTempDir() }).read()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('applying it to the server’s environment', () => {
  test('fills in what the server lacks, never overrides what it has, and merges PATH', async () => {
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      TOKEN: 'mine',
      HOME: '/home/me',
    };
    const reader = {
      read: () =>
        Promise.resolve({ PATH: '/opt/homebrew/bin:/usr/bin', TOKEN: 'theirs', GH_HOST: 'github.com' }),
    };
    expect(await applyLoginEnv(env, reader)).toEqual(['GH_HOST']);
    expect(env).toEqual({
      PATH: '/usr/bin:/bin:/opt/homebrew/bin',
      TOKEN: 'mine',
      HOME: '/home/me',
      GH_HOST: 'github.com',
    });
    const withoutPath: Record<string, string | undefined> = {};
    await applyLoginEnv(withoutPath, { read: () => Promise.resolve({ A: '1' }) }, '/home/me');
    expect(withoutPath).toEqual({ A: '1', PATH: '' });
  });

  test('when the shell cannot be read, PATH gains the usual install folders that exist', async () => {
    const home = createTempDir();
    for (const dir of ['.bun/bin', '.local/bin']) mkdirSync(join(home, dir), { recursive: true });
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin', HOME: home };
    expect(await applyLoginEnv(env, { read: () => Promise.resolve(null) })).toEqual([]);
    const path = env.PATH?.split(':') ?? [];
    expect(path.slice(0, 4)).toEqual(['/usr/bin', '/bin', join(home, '.bun/bin'), join(home, '.local/bin')]);
    const bare: Record<string, string | undefined> = {};
    await applyLoginEnv(bare, { read: () => Promise.resolve(null) }, join(home, 'missing'));
    expect(bare.PATH?.includes('missing')).toBe(false);
  });
});
