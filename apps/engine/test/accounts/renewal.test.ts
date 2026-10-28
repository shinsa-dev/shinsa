import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { RunFailure } from '@shinsa/core';
import { Cswap } from '../../src/accounts/cswap.ts';
import { resolveKeychainService } from '../../src/accounts/paths.ts';
import { describeExpiredLogin, isTokenFailure, LoginRenewal } from '../../src/accounts/renewal.ts';
import type { StoredAccount } from '../../src/accounts/store.ts';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir } from '../helpers/index.ts';

const NOW = 1_000_000;

const HOUR = 60 * 60_000;

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: 'acc-1',
    configDir: '/accounts/acc-1',
    email: 'a@example.com',
    organization: null,
    plan: 'max',
    origin: 'cswap',
    addedAt: 1,
    paused: false,
    switchAt: null,
    ...overrides,
  };
}

function login(refreshToken: string, expiresAt = NOW - HOUR) {
  return JSON.stringify({ claudeAiOauth: { accessToken: `at-${refreshToken}`, refreshToken, expiresAt } });
}

function createRenewal(options: { exported?: string | null; writable?: boolean } = {}) {
  const secrets = new Map<string, string>();
  const exports: string[] = [];
  let exported = options.exported ?? null;
  const run = (command: string[]): Promise<CommandResult> => {
    exports.push(command.at(-1) as string);
    const stdout = exported
      ? JSON.stringify({
          accounts: [
            { email: 'a@example.com', credentials: { claudeAiOauth: JSON.parse(exported).claudeAiOauth } },
          ],
        })
      : '';
    return Promise.resolve({
      ok: exported !== null,
      code: exported ? 0 : 1,
      stdout,
      stderr: '',
      timedOut: false,
    });
  };
  const renewal = new LoginRenewal({
    cswap: new Cswap({ run, which: () => '/bin/cswap' }),
    env: { USER: 'me' },
    userHome: '/nowhere',
    readSecret: (service) => Promise.resolve(secrets.get(service) ?? null),
    writeSecret: (service, _account, value) => {
      if (options.writable === false) return Promise.resolve(false);
      secrets.set(service, value);
      return Promise.resolve(true);
    },
    now: () => NOW,
  });
  return {
    renewal,
    secrets,
    exports,
    store: (dir: string | null, value: string) => secrets.set(resolveKeychainService(dir), value),
    stored: (dir: string | null) => secrets.get(resolveKeychainService(dir)),
    setExport: (value: string | null) => {
      exported = value;
    },
  };
}

function authFailure(code: string | null, failureClass: RunFailure['class'] = 'auth'): RunFailure {
  return { class: failureClass, message: 'Signed out.', code, retryable: null, resetAt: null };
}

describe('which failures a fresh login can fix', () => {
  test('a signed-out or refused token is one; billing, holds and other failures are not', () => {
    expect(isTokenFailure(authFailure('authentication_failed'))).toBe(true);
    expect(isTokenFailure(authFailure('login_required'))).toBe(true);
    expect(isTokenFailure(authFailure('api_error_401'))).toBe(true);
    expect(isTokenFailure(authFailure('billing_error'))).toBe(false);
    expect(isTokenFailure(authFailure(null))).toBe(false);
    expect(isTokenFailure(authFailure('login_required', 'usage_limit'))).toBe(false);
  });
});

describe('reading a login again', () => {
  test('an account from claude-swap takes claude-swap’s current copy when it is another login', async () => {
    const world = createRenewal({ exported: login('fresh', NOW + HOUR) });
    world.store(
      '/accounts/acc-1',
      JSON.stringify({ ...JSON.parse(login('dead')), mcpOAuth: { kept: true } })
    );
    const info = spyOn(log, 'info').mockImplementation(() => undefined);
    try {
      expect(await world.renewal.renew(account())).toBe(true);
      expect(info).toHaveBeenCalledWith('[Accounts] Took claude-swap’s current copy of a login', {
        accountId: 'acc-1',
        email: 'a@example.com',
      });
    } finally {
      info.mockRestore();
    }
    expect(JSON.parse(world.stored('/accounts/acc-1') ?? '{}')).toMatchObject({
      claudeAiOauth: { refreshToken: 'fresh' },
      mcpOAuth: { kept: true },
    });
    expect(world.exports).toEqual(['a@example.com']);
  });

  test('the same copy, or none, leaves only a login that has not expired worth another try', async () => {
    const same = createRenewal({ exported: login('dead') });
    same.store('/accounts/acc-1', login('dead'));
    expect(await same.renewal.renew(account())).toBe(false);
    same.store('/accounts/acc-1', login('refreshed', NOW + HOUR));
    same.setExport(login('refreshed', NOW + HOUR));
    expect(await same.renewal.renew(account())).toBe(true);
    same.store('/accounts/acc-1', login('soon', NOW + 30_000));
    same.setExport(null);
    expect(await same.renewal.renew(account())).toBe(false);
    expect(await createRenewal().renewal.renew(account())).toBe(false);
  });

  test('accounts that are not claude-swap’s never ask it, and one without a folder or email cannot take a copy', async () => {
    const world = createRenewal({ exported: login('fresh', NOW + HOUR) });
    world.store(null, login('mine', NOW + HOUR));
    expect(await world.renewal.renew(account({ origin: 'claude', configDir: null }))).toBe(true);
    expect(await world.renewal.renew(account({ origin: 'login' }))).toBe(false);
    expect(await world.renewal.renew(account({ email: null }))).toBe(false);
    expect(await world.renewal.renew(account({ configDir: null }))).toBe(true);
    expect(world.exports).toEqual([]);
  });

  test('a copy that cannot be written is logged and not tried', async () => {
    const world = createRenewal({ exported: login('fresh', NOW + HOUR), writable: false });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      expect(await world.renewal.renew(account({ configDir: join(createTempDir(), 'gone') }))).toBe(false);
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        '[Accounts] Could not take claude-swap’s copy of a login',
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('noticing a login that works again', () => {
  test('only an account that failed, and only once its stored login changes', async () => {
    const world = createRenewal();
    const failed = account({ origin: 'login' });
    const other = account({ id: 'acc-2', origin: 'login', configDir: '/accounts/acc-2' });
    world.store('/accounts/acc-1', login('dead'));
    world.store('/accounts/acc-2', login('other'));
    await world.renewal.recordFailed(failed);
    expect(await world.renewal.listRenewed([failed, other])).toEqual([]);
    world.store('/accounts/acc-1', login('signed-in-again', NOW + HOUR));
    const renewed = await world.renewal.listRenewed([failed, other]);
    expect(renewed).toEqual([{ account: failed, fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) }]);
    expect(await world.renewal.listRenewed([failed])).toEqual([]);
  });

  test('a claude-swap account picks up a new sign-in there; a login that is gone is not back', async () => {
    const world = createRenewal({ exported: login('dead') });
    world.store('/accounts/acc-1', login('dead'));
    await world.renewal.recordFailed(account());
    expect(await world.renewal.listRenewed([account()])).toEqual([]);
    world.setExport(login('relogged', NOW + HOUR));
    expect(await world.renewal.listRenewed([account()])).toHaveLength(1);
    expect(JSON.parse(world.stored('/accounts/acc-1') ?? '{}').claudeAiOauth.refreshToken).toBe('relogged');

    const gone = createRenewal();
    await gone.renewal.recordFailed(account({ origin: 'login' }));
    expect(await gone.renewal.listRenewed([account({ origin: 'login' })])).toEqual([]);
    gone.renewal.clear('acc-1');
    gone.store('/accounts/acc-1', login('new', NOW + HOUR));
    expect(await gone.renewal.listRenewed([account({ origin: 'login' })])).toEqual([]);
  });
});

describe('what the Sign in gate says', () => {
  test('names the account, the others that need signing in, and how to sign in for where the login comes from', () => {
    expect(describeExpiredLogin(account(), [])).toBe(
      'Claude could not refresh the login of a@example.com. Sign in to it here, or sign in to Claude Code as a@example.com and run `cswap add`: Shinsa takes the new login from claude-swap.'
    );
    expect(describeExpiredLogin(account({ origin: 'claude' }), [account({ email: 'b@example.com' })])).toBe(
      'Claude could not refresh the login of a@example.com, and b@example.com needs signing in again too. Sign in to it here, or run `claude auth login` in a terminal.'
    );
    expect(
      describeExpiredLogin(account({ origin: 'login', email: null }), [
        account({ email: 'b@example.com' }),
        account({ email: null }),
        account({ email: 'c@example.com' }),
      ])
    ).toBe(
      'Claude could not refresh the login of this account, and b@example.com, an account without an email and c@example.com need signing in again too. Sign in to it here.'
    );
  });
});
