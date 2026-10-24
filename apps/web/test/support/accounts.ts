import type {
  AccountLogin,
  AccountSummary,
  AccountsSnapshot,
  ProviderLogin,
  UsageWindow,
} from '@shinsa/core';
import { NOW } from './state.ts';

const HOUR = 3_600_000;

export function createWindow(overrides: Partial<UsageWindow> & { id: string }): UsageWindow {
  return {
    kind: 'session',
    label: 'Current session',
    model: null,
    usedPercent: 20,
    resetsAt: NOW + 3 * HOUR,
    ...overrides,
  };
}

export function createAccount(overrides: Partial<AccountSummary> & { id: string }): AccountSummary {
  return {
    email: `${overrides.id}@example.com`,
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
      windows: [createWindow({ id: `${overrides.id}-session` })],
      detail: null,
      checkedAt: NOW - 120_000,
      source: 'read',
    },
    spentUntil: null,
    runs: 0,
    ...overrides,
  };
}

export function createLogin(overrides: Partial<AccountLogin> = {}): AccountLogin {
  return {
    id: 'login-1',
    accountId: 'new',
    email: null,
    phase: 'waiting',
    url: 'https://claude.ai/oauth/authorize?code=abc',
    message: null,
    startedAt: NOW,
    ...overrides,
  };
}

export function createSnapshot(overrides: Partial<AccountsSnapshot> = {}): AccountsSnapshot {
  return { accounts: [], login: null, imports: [], ...overrides };
}

export function createProviderLogin(overrides: Partial<ProviderLogin> = {}): ProviderLogin {
  return {
    provider: 'codex',
    label: 'Codex',
    status: 'signed_in',
    method: 'ChatGPT',
    version: '0.159.0',
    detail: 'Signed in with ChatGPT.',
    fix: null,
    email: 'codex@example.com',
    plan: 'plus',
    usage: {
      status: 'ok',
      windows: [
        createWindow({ id: 'five_hour', label: '5-hour limit', usedPercent: 12 }),
        createWindow({
          id: 'seven_day',
          kind: 'weekly',
          label: 'Weekly limit',
          usedPercent: 64,
          resetsAt: NOW + 50 * HOUR,
        }),
      ],
      detail: null,
      checkedAt: NOW - 60_000,
      source: 'read',
      fastMode: 'needs_credits',
    },
    ...overrides,
  };
}
