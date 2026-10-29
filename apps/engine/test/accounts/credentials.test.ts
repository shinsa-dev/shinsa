import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createKeychainReader,
  createKeychainWriter,
  parseStoredLogin,
  readStoredLogin,
  type SecretReader,
  type SecretRunner,
  type SecretWriter,
  writeStoredLogin,
} from '../../src/accounts/credentials.ts';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

function createRunner(result: Partial<CommandResult>) {
  const calls: { command: string[]; cwd: string; timeoutMs: number; input?: string }[] = [];
  const run: SecretRunner = (command, cwd, options) => {
    calls.push({ command, cwd, ...options });
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
    ).toEqual({ accessToken: 'tok', refreshToken: null, expiresAt: 123, plan: 'max' });
    expect(
      parseStoredLogin(
        serializeLogin({ accessToken: 'tok', refreshToken: 'ref', expiresAt: '123', subscriptionType: 7 })
      )
    ).toEqual({ accessToken: 'tok', refreshToken: 'ref', expiresAt: null, plan: null });
  });

  test('anything without a usable access token is no login', () => {
    expect(parseStoredLogin('not json')).toBeNull();
    expect(parseStoredLogin('{}')).toBeNull();
    expect(parseStoredLogin('[1]')).toBeNull();
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
    expect(login).toEqual({ accessToken: 'from-file', refreshToken: null, expiresAt: null, plan: 'pro' });
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

function decodeLine(line: string) {
  const hex = /-X "([0-9a-f]+)"/.exec(line)?.[1] ?? '';
  return Buffer.from(hex, 'hex').toString('utf8');
}

describe('keychain writer', () => {
  test('pipes the login to security as hex, so it never shows in the process list', async () => {
    const { run, calls } = createRunner({ ok: true });
    const write = createKeychainWriter(run, 'darwin');
    expect(await write('Claude Code-credentials-1234abcd', 'chris "o"', '{"a":1}')).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toEqual(['/usr/bin/security', '-i']);
    expect(call?.input).toStartWith(
      'add-generic-password -U -a "chris \\"o\\"" -s "Claude Code-credentials-1234abcd" -X "'
    );
    expect(decodeLine(call?.input ?? '')).toBe('{"a":1}');
  });

  test('a login too long for one line of security’s input goes as arguments instead', async () => {
    const { run, calls } = createRunner({ ok: true });
    const value = JSON.stringify({ mcpOAuth: 'x'.repeat(3_000) });
    expect(await createKeychainWriter(run, 'darwin')('service', 'me', value)).toBe(true);
    const command = calls[0]?.command ?? [];
    expect(command.slice(0, 7)).toEqual([
      '/usr/bin/security',
      'add-generic-password',
      '-U',
      '-a',
      'me',
      '-s',
      'service',
    ]);
    expect(Buffer.from(command[8] ?? '', 'hex').toString('utf8')).toBe(value);
    expect(calls[0]?.input).toBeUndefined();
  });

  test('a keychain that refuses is logged, and off a Mac nothing is written there', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      expect(
        await createKeychainWriter(createRunner({ code: 51 }).run, 'darwin')('service', 'me', '{}')
      ).toBe(false);
      expect(warn).toHaveBeenCalledWith('[Accounts] The keychain did not take a login', {
        service: 'service',
        code: 51,
      });
    } finally {
      warn.mockRestore();
    }
    const { run, calls } = createRunner({ ok: true });
    expect(await createKeychainWriter(run, 'linux')('service', 'me', '{}')).toBe(false);
    expect(calls).toHaveLength(0);
    expect(typeof createKeychainWriter()).toBe('function');
  });
});

describe('writing a login into an account folder', () => {
  test('replaces only the Claude login in the keychain entry, keeping the rest', async () => {
    const written: [string, string, string][] = [];
    const writeSecret: SecretWriter = (service, account, value) => {
      written.push([service, account, value]);
      return Promise.resolve(true);
    };
    await writeStoredLogin(
      {
        configDir: '/Users/christo/.claude',
        env: { USER: 'christo' },
        readSecret: () =>
          Promise.resolve(JSON.stringify({ claudeAiOauth: { accessToken: 'old' }, mcpOAuth: { s: 1 } })),
        writeSecret,
      },
      { accessToken: 'new', refreshToken: 'r' }
    );
    expect(written).toEqual([
      [
        'Claude Code-credentials-09ac30cc',
        'christo',
        JSON.stringify({ claudeAiOauth: { accessToken: 'new', refreshToken: 'r' }, mcpOAuth: { s: 1 } }),
      ],
    ]);
  });

  test('without a keychain the folder’s .credentials.json gets it, kept to its owner', async () => {
    const dir = createTempDir();
    writeFiles(dir, {
      '.credentials.json': JSON.stringify({ claudeAiOauth: { accessToken: 'old' }, other: 2 }),
    });
    const query = {
      configDir: dir,
      env: { USER: 'me' },
      readSecret: () => Promise.resolve('not json'),
      writeSecret: () => Promise.resolve(false),
    };
    await writeStoredLogin(query, { accessToken: 'new' });
    expect(JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8'))).toEqual({
      claudeAiOauth: { accessToken: 'new' },
      other: 2,
    });
    const fresh = createTempDir();
    await writeStoredLogin({ ...query, configDir: fresh }, { accessToken: 'first' });
    expect(JSON.parse(readFileSync(join(fresh, '.credentials.json'), 'utf8'))).toEqual({
      claudeAiOauth: { accessToken: 'first' },
    });
  });
});
