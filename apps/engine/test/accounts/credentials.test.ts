import { describe, expect, spyOn, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createKeychainReader,
  parseStoredLogin,
  readStoredLogin,
  type SecretReader,
  type SecretRunner,
} from '../../src/accounts/credentials.ts';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

function createRunner(result: Partial<CommandResult>) {
  const calls: { command: string[]; cwd: string; timeoutMs: number }[] = [];
  const run: SecretRunner = (command, cwd, options) => {
    calls.push({ command, cwd, timeoutMs: options.timeoutMs });
    return Promise.resolve({ ok: false, code: 0, stdout: '', stderr: '', timedOut: false, ...result });
  };
  return { run, calls };
}

function serializeLogin(oauth: Record<string, unknown>) {
  return JSON.stringify({ claudeAiOauth: oauth });
}

describe('keychain reader', () => {
  test('asks security for the password of the service and account on a Mac', async () => {
    const { run, calls } = createRunner({ ok: true, stdout: '{"secret":1}' });
    const read = createKeychainReader(run, 'darwin');
    expect(await read('Claude Code-credentials', 'christo')).toBe('{"secret":1}');
    expect(calls).toEqual([
      {
        command: [
          '/usr/bin/security',
          'find-generic-password',
          '-a',
          'christo',
          '-s',
          'Claude Code-credentials',
          '-w',
        ],
        cwd: homedir(),
        timeoutMs: 5_000,
      },
    ]);
  });

  test('there is no keychain off a Mac, so nothing is run', async () => {
    const { run, calls } = createRunner({ ok: true, stdout: 'x' });
    expect(await createKeychainReader(run, 'linux')('service', 'me')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a missing entry is quietly nothing; a keychain that does not answer is logged', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const missing = createKeychainReader(createRunner({ code: 44 }).run, 'darwin');
      expect(await missing('service', 'me')).toBeNull();
      expect(warn).not.toHaveBeenCalled();
      const locked = createKeychainReader(createRunner({ code: 51 }).run, 'darwin');
      expect(await locked('service', 'me')).toBeNull();
      expect(warn).toHaveBeenCalledWith('[Accounts] The keychain did not answer', {
        service: 'service',
        code: 51,
      });
    } finally {
      warn.mockRestore();
    }
  });

  test('reads the keychain of the platform Shinsa runs on by default', async () => {
    const read = createKeychainReader(createRunner({ code: 44 }).run);
    expect(await read('service', 'me')).toBeNull();
  });
});

describe('stored login', () => {
  test('reads the access token and the plan', () => {
    expect(
      parseStoredLogin(serializeLogin({ accessToken: 'tok', expiresAt: 123, subscriptionType: 'max' }))
    ).toEqual({ accessToken: 'tok', plan: 'max' });
    expect(
      parseStoredLogin(serializeLogin({ accessToken: 'tok', expiresAt: '123', subscriptionType: 7 }))
    ).toEqual({ accessToken: 'tok', plan: null });
  });

  test('anything without a usable access token is no login', () => {
    expect(parseStoredLogin('not json')).toBeNull();
    expect(parseStoredLogin('{}')).toBeNull();
    expect(parseStoredLogin(serializeLogin({ accessToken: '' }))).toBeNull();
    expect(parseStoredLogin(serializeLogin({ accessToken: 42 }))).toBeNull();
  });

  test('an account folder is looked up under its hashed keychain service first', async () => {
    const asked: [string, string][] = [];
    const readSecret: SecretReader = (service, account) => {
      asked.push([service, account]);
      return Promise.resolve(serializeLogin({ accessToken: 'from-keychain' }));
    };
    const login = await readStoredLogin({
      configDir: '/Users/christo/.claude',
      env: { USER: 'christo' },
      userHome: '/Users/christo',
      readSecret,
    });
    expect(login?.accessToken).toBe('from-keychain');
    expect(asked).toEqual([['Claude Code-credentials-09ac30cc', 'christo']]);
  });

  test('the Claude Code login follows an inherited CLAUDE_CONFIG_DIR, else the default service', async () => {
    const asked: string[] = [];
    const readSecret: SecretReader = (service) => {
      asked.push(service);
      return Promise.resolve(null);
    };
    const userHome = createTempDir();
    await readStoredLogin({ configDir: null, env: { USER: 'me' }, userHome, readSecret });
    await readStoredLogin({
      configDir: null,
      env: { USER: 'me', CLAUDE_CONFIG_DIR: '/Users/christo/.claude' },
      userHome,
      readSecret,
    });
    expect(asked).toEqual(['Claude Code-credentials', 'Claude Code-credentials-09ac30cc']);
  });

  test('falls back to .credentials.json when the keychain has nothing usable', async () => {
    const dir = createTempDir();
    writeFiles(dir, {
      '.credentials.json': serializeLogin({ accessToken: 'from-file', subscriptionType: 'pro' }),
    });
    const login = await readStoredLogin({
      configDir: dir,
      env: { USER: 'me' },
      userHome: '/nowhere',
      readSecret: () => Promise.resolve('garbage'),
    });
    expect(login).toEqual({ accessToken: 'from-file', plan: 'pro' });
  });

  test('without a config dir the file fallback is ~/.claude/.credentials.json', async () => {
    const home = createTempDir();
    writeFiles(home, { '.claude/.credentials.json': serializeLogin({ accessToken: 'home-file' }) });
    const login = await readStoredLogin({
      configDir: null,
      env: { USER: 'me' },
      userHome: home,
      readSecret: () => Promise.resolve(null),
    });
    expect(login?.accessToken).toBe('home-file');
  });

  test('no keychain entry and no file means no login', async () => {
    const login = await readStoredLogin({
      configDir: join(createTempDir(), 'missing'),
      env: { USER: 'me' },
      userHome: '/nowhere',
      readSecret: () => Promise.resolve(null),
    });
    expect(login).toBeNull();
  });
});
