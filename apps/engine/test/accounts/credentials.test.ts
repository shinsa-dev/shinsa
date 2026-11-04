import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { parseStoredLogin } from '../../src/accounts/answers.ts';
import { StoredLogins } from '../../src/accounts/credentials/service.ts';
import { Keychain } from '../../src/accounts/keychain/service.ts';
import { captureLogs, createTempDir, createTestConfig, writeFiles } from '../helpers/index.ts';
import {
  type AccountsHarness,
  type AccountsHarnessOptions,
  buildUnitAccounts,
  type FakeSecretReader,
} from './harness.ts';

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function build(options: Partial<AccountsHarnessOptions>) {
  const harness = await buildUnitAccounts(options);
  open.push(harness);
  return harness;
}

async function readKeychain(options: Partial<AccountsHarnessOptions>, service: string, account: string) {
  const harness = await build(options);
  return harness.run(harness.service(Keychain).read(service, account));
}

function serializeLogin(oauth: Record<string, unknown>) {
  return JSON.stringify({ claudeAiOauth: oauth });
}

async function readLogin(
  configDir: string | null,
  options: { env: Record<string, string>; userHome: string; readSecret: FakeSecretReader }
) {
  const root = createTempDir();
  const harness = await build({
    config: { ...createTestConfig(root), userHome: options.userHome },
    env: options.env,
    readSecret: options.readSecret,
  });
  return harness.run(harness.service(StoredLogins).read(configDir));
}

describe('keychain reader', () => {
  test('asks security for the password of the service and account on a Mac', async () => {
    const userHome = createTempDir();
    const harness = await build({
      config: { ...createTestConfig(createTempDir()), userHome },
      readSecret: () => Promise.resolve('{"secret":1}'),
    });
    expect(await harness.run(harness.service(Keychain).read('Claude Code-credentials', 'christo'))).toBe(
      '{"secret":1}'
    );
    expect(harness.calls).toEqual([
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
        cwd: userHome,
        timeoutMs: 5_000,
      },
    ]);
  });

  test('reads the secret security answers, under a five second timeout', async () => {
    const asked: [string, string][] = [];
    const secret = await readKeychain(
      {
        readSecret: (service, account) => {
          asked.push([service, account]);
          return Promise.resolve('{"secret":1}');
        },
      },
      'Claude Code-credentials',
      'christo'
    );
    expect(secret).toBe('{"secret":1}');
    expect(asked).toEqual([['Claude Code-credentials', 'christo']]);
  });

  test('there is no keychain off a Mac, so nothing is run', async () => {
    const asked: string[] = [];
    const secret = await readKeychain(
      {
        platform: 'linux',
        readSecret: (service) => {
          asked.push(service);
          return Promise.resolve('x');
        },
      },
      'service',
      'me'
    );
    expect(secret).toBeNull();
    expect(asked).toEqual([]);
  });

  test('a missing entry is quietly nothing; a keychain that does not answer is logged', async () => {
    const logs = captureLogs();
    try {
      expect(await readKeychain({ readSecret: () => Promise.resolve(null) }, 'service', 'me')).toBeNull();
      expect(logs.fieldsOf('[Accounts] The keychain did not answer')).toEqual([]);
      const locked = { ok: false, code: 51, stdout: '', stderr: '', timedOut: false };
      expect(await readKeychain({ readSecret: () => Promise.resolve(locked) }, 'service', 'me')).toBeNull();
      expect(logs.fieldsOf('[Accounts] The keychain did not answer')).toEqual([
        { service: 'service', code: 51 },
      ]);
    } finally {
      logs.restore();
    }
  });
});

describe('the platform Shinsa runs on', () => {
  test('decides whether there is a keychain to read', async () => {
    const asked: string[] = [];
    const secret = await readKeychain(
      {
        platform: 'host',
        readSecret: (service) => {
          asked.push(service);
          return Promise.resolve('x');
        },
      },
      'service',
      'me'
    );
    expect(secret).toBe(process.platform === 'darwin' ? 'x' : null);
    expect(asked).toHaveLength(process.platform === 'darwin' ? 1 : 0);
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
    const login = await readLogin('/Users/christo/.claude', {
      env: { USER: 'christo' },
      userHome: '/Users/christo',
      readSecret: (service, account) => {
        asked.push([service, account]);
        return Promise.resolve(serializeLogin({ accessToken: 'from-keychain' }));
      },
    });
    expect(login?.accessToken).toBe('from-keychain');
    expect(asked).toEqual([['Claude Code-credentials-09ac30cc', 'christo']]);
  });

  test('the Claude Code login follows an inherited CLAUDE_CONFIG_DIR, else the default service', async () => {
    const asked: string[] = [];
    const readSecret: FakeSecretReader = (service) => {
      asked.push(service);
      return Promise.resolve(null);
    };
    const userHome = createTempDir();
    await readLogin(null, { env: { USER: 'me' }, userHome, readSecret });
    await readLogin(null, {
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
    const login = await readLogin(dir, {
      env: { USER: 'me' },
      userHome: '/nowhere',
      readSecret: () => Promise.resolve('garbage'),
    });
    expect(login).toEqual({ accessToken: 'from-file', refreshToken: null, expiresAt: null, plan: 'pro' });
  });

  test('without a config dir the file fallback is ~/.claude/.credentials.json', async () => {
    const home = createTempDir();
    writeFiles(home, { '.claude/.credentials.json': serializeLogin({ accessToken: 'home-file' }) });
    const login = await readLogin(null, {
      env: { USER: 'me' },
      userHome: home,
      readSecret: () => Promise.resolve(null),
    });
    expect(login?.accessToken).toBe('home-file');
  });

  test('no keychain entry and no file means no login', async () => {
    const login = await readLogin(join(createTempDir(), 'missing'), {
      env: { USER: 'me' },
      userHome: '/nowhere',
      readSecret: () => Promise.resolve(null),
    });
    expect(login).toBeNull();
  });
});
