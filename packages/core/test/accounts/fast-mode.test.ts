import { describe, expect, test } from 'bun:test';
import {
  type AccountSummary,
  type AccountsSnapshot,
  type FastModeAvailability,
  type ProviderLogin,
  resolveFastModeAvailability,
} from '../../src/index.ts';

function createAccount(
  id: string,
  fastMode: FastModeAvailability | undefined,
  patch: Partial<AccountSummary> = {}
): AccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    organization: null,
    plan: 'max',
    origin: 'login',
    isDefault: false,
    paused: false,
    switchAt: null,
    signIn: 'signed_in',
    signInDetail: null,
    usage: {
      status: 'ok',
      windows: [],
      detail: null,
      checkedAt: 1,
      source: 'read',
      ...(fastMode ? { fastMode } : {}),
    },
    spentUntil: null,
    runs: 0,
    ...patch,
  };
}

function createCodex(fastMode: FastModeAvailability | undefined, usage = true): ProviderLogin {
  return {
    provider: 'codex',
    label: 'Codex',
    status: 'signed_in',
    method: 'ChatGPT',
    version: '0.159.0',
    detail: null,
    fix: null,
    ...(usage
      ? {
          usage: {
            status: 'ok',
            windows: [],
            detail: null,
            checkedAt: 1,
            source: 'read',
            ...(fastMode ? { fastMode } : {}),
          },
        }
      : {}),
  };
}

function createSnapshot(accounts: AccountSummary[], providers?: ProviderLogin[]): AccountsSnapshot {
  return { accounts, login: null, imports: [], ...(providers ? { providers } : {}) };
}

describe('resolveFastModeAvailability', () => {
  test('Claude runs fast when any account that takes work has usage credits', () => {
    const snapshot = createSnapshot([createAccount('a', 'needs_credits'), createAccount('b', 'available')]);
    expect(resolveFastModeAvailability(snapshot, 'claude')).toBe('available');
  });

  test('Claude needs usage credits when no account that takes work has them', () => {
    const snapshot = createSnapshot([
      createAccount('a', 'needs_credits'),
      createAccount('b', 'available', { paused: true }),
      createAccount('c', 'available', { signIn: 'signed_out' }),
    ]);
    expect(resolveFastModeAvailability(snapshot, 'claude')).toBe('needs_credits');
  });

  test('an account Shinsa has not read yet, or no account at all, leaves it unknown', () => {
    expect(
      resolveFastModeAvailability(
        createSnapshot([createAccount('a', 'needs_credits'), createAccount('b', undefined)]),
        'claude'
      )
    ).toBe('unknown');
    expect(resolveFastModeAvailability(createSnapshot([]), 'claude')).toBe('unknown');
    expect(resolveFastModeAvailability(null, 'claude')).toBe('unknown');
  });

  test('a provider with a sign-in of its own answers from its own usage reading', () => {
    expect(resolveFastModeAvailability(createSnapshot([], [createCodex('available')]), 'codex')).toBe(
      'available'
    );
    expect(resolveFastModeAvailability(createSnapshot([], [createCodex('needs_credits')]), 'codex')).toBe(
      'needs_credits'
    );
    expect(resolveFastModeAvailability(createSnapshot([], [createCodex(undefined)]), 'codex')).toBe(
      'unknown'
    );
    expect(resolveFastModeAvailability(createSnapshot([], [createCodex('available', false)]), 'codex')).toBe(
      'unknown'
    );
    expect(resolveFastModeAvailability(createSnapshot([createAccount('a', 'available')]), 'codex')).toBe(
      'unknown'
    );
  });
});
