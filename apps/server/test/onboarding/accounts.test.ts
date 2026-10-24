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
      summary({ id: 'acc-2', email: null, plan: null }),
      summary({ id: 'acc-3', signIn: 'signed_out' }),
      summary({ id: 'acc-4', signIn: 'unknown', signInDetail: 'Claude took too long to answer.' }),
      summary({ id: 'acc-5', signIn: 'unknown' }),
    ]);
    expect(await list()).toEqual([
      { id: 'acc-1', signedIn: true, detail: 'Signed in, Max plan.', label: 'me@example.com' },
      { id: 'acc-2', signedIn: true, detail: 'Signed in.', label: 'Claude account' },
      { id: 'acc-3', signedIn: false, detail: 'Needs you to sign in again.', label: 'me@example.com' },
      { id: 'acc-4', signedIn: false, detail: 'Claude took too long to answer.', label: 'me@example.com' },
      { id: 'acc-5', signedIn: false, detail: 'Not checked yet.', label: 'me@example.com' },
    ]);
  });
});
