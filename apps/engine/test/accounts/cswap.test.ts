import { describe, expect, spyOn, test } from 'bun:test';
import { homedir } from 'node:os';
import { Cswap, type CswapRunner, parseCswapExport, parseCswapList } from '../../src/accounts/cswap.ts';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';

const LIST = JSON.stringify({
  accounts: [
    { email: 'a@x.dev', organizationName: 'Acme', kind: 'oauth' },
    { email: 'key@x.dev', kind: 'api_key' },
    { email: 'b@x.dev', organizationName: 7 },
    { organizationName: 'No email' },
    'junk',
    null,
  ],
});

const EXPORT = JSON.stringify({
  accounts: [
    { email: 'other@x.dev', credentials: { claudeAiOauth: { refreshToken: 'nope' } } },
    {
      email: 'Me@X.dev',
      credentials: { claudeAiOauth: { accessToken: 'at', refreshToken: 'rt' } },
      config: { oauthAccount: { emailAddress: 'me@x.dev', organizationName: 'Acme' } },
    },
  ],
});

function createRunner(results: Partial<CommandResult>[]) {
  const calls: { command: string[]; cwd: string; timeoutMs: number | undefined }[] = [];
  const run: CswapRunner = (command, cwd, options) => {
    calls.push({ command, cwd, timeoutMs: options.timeoutMs });
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, ...result });
  };
  return { run, calls };
}

describe('claude-swap output', () => {
  test('lists the OAuth accounts and skips API keys and junk', () => {
    expect(parseCswapList(LIST)).toEqual([{ email: 'a@x.dev' }, { email: 'b@x.dev' }]);
    expect(parseCswapList('{"accounts":"none"}')).toEqual([]);
    expect(parseCswapList('not json')).toEqual([]);
  });

  test('an export finds the account by email in any case and keeps its login and OAuth account', () => {
    expect(parseCswapExport(EXPORT, 'me@x.dev')).toEqual({
      credentials: { claudeAiOauth: { accessToken: 'at', refreshToken: 'rt' } },
      oauthAccount: { emailAddress: 'me@x.dev', organizationName: 'Acme' },
    });
  });

  test('an export without a refresh token, an account or valid JSON is no login', () => {
    const withoutRefresh = JSON.stringify({
      accounts: [{ email: 'me@x.dev', credentials: { claudeAiOauth: { accessToken: 'at' } } }],
    });
    expect(parseCswapExport(withoutRefresh, 'me@x.dev')).toBeNull();
    expect(parseCswapExport(EXPORT, 'missing@x.dev')).toBeNull();
    expect(parseCswapExport('{"accounts":{}}', 'me@x.dev')).toBeNull();
    expect(parseCswapExport('{', 'me@x.dev')).toBeNull();
  });

  test('an export without a config keeps the login and no OAuth account', () => {
    const bare = JSON.stringify({
      accounts: [{ email: 'me@x.dev', credentials: { claudeAiOauth: { refreshToken: 'rt' } } }],
    });
    expect(parseCswapExport(bare, 'me@x.dev')).toEqual({
      credentials: { claudeAiOauth: { refreshToken: 'rt' } },
      oauthAccount: null,
    });
  });
});

describe('Cswap', () => {
  test('lists through cswap, then answers from memory for ten minutes', async () => {
    let now = 1_000;
    const { run, calls } = createRunner([{ stdout: LIST }]);
    const cswap = new Cswap({
      run,
      which: (name) => (name === 'cswap' ? '/bin/cswap' : null),
      now: () => now,
    });
    expect(await cswap.list()).toHaveLength(2);
    now += 10 * 60_000 - 1;
    expect(await cswap.list()).toHaveLength(2);
    expect(calls).toEqual([{ command: ['/bin/cswap', 'list', '--json'], cwd: homedir(), timeoutMs: 30_000 }]);
    now += 1;
    await cswap.list();
    expect(calls).toHaveLength(2);
  });

  test('without claude-swap installed there are no accounts and no login to export', async () => {
    const { run, calls } = createRunner([]);
    const cswap = new Cswap({ run, which: () => null });
    expect(await cswap.list()).toEqual([]);
    expect(await cswap.export('me@x.dev')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a failed list or export is logged and gives nothing', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const { run } = createRunner([{ ok: false, code: 2, stdout: LIST }]);
      const cswap = new Cswap({ run, which: () => '/bin/cswap' });
      expect(await cswap.list()).toEqual([]);
      expect(await cswap.export('me@x.dev')).toBeNull();
      expect(warn.mock.calls).toEqual([
        ['[Accounts] claude-swap did not list its accounts', { code: 2 }],
        ['[Accounts] claude-swap could not export a login', { code: 2 }],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test('exports one account’s login to stdout', async () => {
    const { run, calls } = createRunner([{ stdout: EXPORT }]);
    const cswap = new Cswap({ run, which: () => '/bin/cswap' });
    expect((await cswap.export('me@x.dev'))?.credentials.claudeAiOauth.refreshToken).toBe('rt');
    expect(calls[0]?.command).toEqual(['/bin/cswap', 'export', '-', '--account', 'me@x.dev']);
  });

  test('looks for cswap, then claude-swap, on PATH', async () => {
    const which = spyOn(Bun, 'which').mockImplementation((name) =>
      name === 'claude-swap' ? '/opt/claude-swap' : null
    );
    try {
      const { run, calls } = createRunner([{ stdout: LIST }]);
      await new Cswap({ run }).list();
      expect(which.mock.calls.map(([name]) => name)).toEqual(['cswap', 'claude-swap']);
      expect(calls[0]?.command[0]).toBe('/opt/claude-swap');
    } finally {
      which.mockRestore();
    }
  });
});
