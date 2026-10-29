import { describe, expect, test } from 'bun:test';
import type { RunFailure } from '@shinsa/core';
import { resolveKeychainService } from '../../src/accounts/paths.ts';
import { describeExpiredLogin, isTokenFailure, LoginRenewal } from '../../src/accounts/renewal.ts';
import type { StoredAccount } from '../../src/accounts/store.ts';

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

function createRenewal() {
  const secrets = new Map<string, string>();
  const renewal = new LoginRenewal({
    env: { USER: 'me' },
    userHome: '/nowhere',
    readSecret: (service) => Promise.resolve(secrets.get(service) ?? null),
    now: () => NOW,
  });
  return {
    renewal,
    store: (dir: string | null, value: string) => secrets.set(resolveKeychainService(dir), value),
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
  test('only a stored login that has not expired is worth another try, whatever its account’s origin', async () => {
    const world = createRenewal();
    world.store('/accounts/acc-1', login('dead'));
    expect(await world.renewal.renew(account())).toBe(false);
    world.store('/accounts/acc-1', login('refreshed', NOW + HOUR));
    expect(await world.renewal.renew(account())).toBe(true);
    world.store('/accounts/acc-1', login('soon', NOW + 30_000));
    expect(await world.renewal.renew(account({ origin: 'login' }))).toBe(false);
    world.store(null, login('mine', NOW + HOUR));
    expect(await world.renewal.renew(account({ origin: 'claude', configDir: null }))).toBe(true);
    expect(await createRenewal().renewal.renew(account())).toBe(false);
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

  test('a login that is gone is not back, and a cleared account is not watched', async () => {
    const gone = createRenewal();
    await gone.renewal.recordFailed(account());
    expect(await gone.renewal.listRenewed([account()])).toEqual([]);
    gone.renewal.clear('acc-1');
    gone.store('/accounts/acc-1', login('new', NOW + HOUR));
    expect(await gone.renewal.listRenewed([account()])).toEqual([]);
  });
});

describe('what the Sign in gate says', () => {
  test('names the account, the others that need signing in, and how to sign in for where the login comes from', () => {
    expect(describeExpiredLogin(account(), [])).toBe(
      'Claude could not refresh the login of a@example.com. Sign in to it here, so Shinsa has a login of its own.'
    );
    expect(describeExpiredLogin(account({ origin: 'claude' }), [account({ email: 'b@example.com' })])).toBe(
      'Claude could not refresh the login of a@example.com, and b@example.com needs signing in again too. Sign in to it here, so Shinsa has a login of its own.'
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
