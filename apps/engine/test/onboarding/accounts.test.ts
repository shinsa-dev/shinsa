import { describe, expect, test } from 'bun:test';
import type { AccountSummary } from '@shinsa/core';
import { createSummaryAccountSource } from '../../src/onboarding/accounts.ts';

function summary(overrides: Partial<AccountSummary>): AccountSummary {
  return {
    id: 'acc-1',
    email: 'me@example.com',
    organization: null,
    plan: 'max',
    origin: 'login',
    isDefault: true,
    paused: false,
    switchAt: null,
    signIn: 'signed_in',
    signInDetail: null,
    usage: { status: 'unknown', windows: [], detail: null, checkedAt: null, source: null },
    spentUntil: null,
    runs: 0,
    ...overrides,
  };
}

describe('createSummaryAccountSource', () => {
  test('lists Shinsa’s accounts with their email and whether each can work', async () => {
    const list = createSummaryAccountSource(() => [
      summary({}),
      summary({ id: 'acc-2', email: null }),
      summary({ id: 'acc-3', signIn: 'signed_out' }),
      summary({ id: 'acc-4', signIn: 'unknown' }),
    ]);
    expect(await list()).toEqual([
      { id: 'acc-1', email: 'me@example.com', signedIn: true },
      { id: 'acc-2', email: null, signedIn: true },
      { id: 'acc-3', email: 'me@example.com', signedIn: false },
      { id: 'acc-4', email: 'me@example.com', signedIn: false },
    ]);
  });
});
