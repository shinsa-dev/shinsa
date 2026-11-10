import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  type AccountCandidate,
  type AccountSummary,
  type AccountUsage,
  createSettings,
  isUsableAccount,
  type PickRequest,
  pickAccount,
  resolveCandidateSpentUntil,
  resolvePoolResetAt,
  selectNextAccount,
  STALE_USAGE_MS,
  type UsageWindow,
} from '../../src/index.ts';

const NOW = 1_000_000;

function createUsage(windows: Partial<UsageWindow>[]): AccountUsage {
  return {
    status: windows.length > 0 ? 'ok' : 'unknown',
    windows: windows.map((window) => ({
      id: 'five_hour',
      kind: 'session',
      label: '5-hour limit',
      model: null,
      usedPercent: 0,
      resetsAt: NOW + 60_000,
      ...window,
    })),
    detail: null,
    checkedAt: NOW,
    source: 'read',
  };
}

function createCandidate(id: string, patch: Partial<AccountCandidate> = {}, used?: number): AccountCandidate {
  return {
    id,
    isDefault: false,
    paused: false,
    signIn: 'signed_in',
    usage: createUsage(used === undefined ? [] : [{ usedPercent: used }]),
    spentUntil: null,
    switchAt: 90,
    ...patch,
  };
}

function createRequest(accounts: AccountCandidate[], patch: Partial<PickRequest> = {}): PickRequest {
  return { accounts, bound: null, previous: null, model: null, exclude: new Set(), now: NOW, ...patch };
}

const FABLE_SPENT = createUsage([
  { usedPercent: 20 },
  {
    id: 'weekly:fable',
    kind: 'model',
    label: 'Weekly · Fable',
    model: 'Fable',
    usedPercent: 100,
    resetsAt: NOW + 5_000,
  },
]);

describe('spent accounts', () => {
  test('an account is spent until the later of its marked and its measured reset', () => {
    const marked = createCandidate('a', { spentUntil: NOW + 10_000 });
    expect(Option.getOrNull(resolveCandidateSpentUntil(marked, null, NOW))).toBe(NOW + 10_000);
    const measured = createCandidate('b', {}, 100);
    expect(Option.getOrNull(resolveCandidateSpentUntil(measured, null, NOW))).toBe(NOW + 60_000);
    const both = createCandidate('c', { spentUntil: NOW + 90_000 }, 100);
    expect(Option.getOrNull(resolveCandidateSpentUntil(both, null, NOW))).toBe(NOW + 90_000);
    const earlierMark = createCandidate('d', { spentUntil: NOW + 1_000 }, 100);
    expect(Option.getOrNull(resolveCandidateSpentUntil(earlierMark, null, NOW))).toBe(NOW + 60_000);
    const pastMark = createCandidate('e', { spentUntil: NOW - 1 });
    expect(Option.getOrNull(resolveCandidateSpentUntil(pastMark, null, NOW))).toBeNull();
  });

  test('a model window only spends the account for that model', () => {
    const account = createCandidate('a', { usage: FABLE_SPENT });
    expect(Option.getOrNull(resolveCandidateSpentUntil(account, 'claude-fable-5', NOW))).toBe(NOW + 5_000);
    expect(Option.getOrNull(resolveCandidateSpentUntil(account, 'claude-opus-4-1', NOW))).toBeNull();
  });

  test('a paused, signed-out or spent account is not usable', () => {
    expect(isUsableAccount(createCandidate('a'), null, NOW)).toBe(true);
    expect(isUsableAccount(createCandidate('a', { signIn: 'unknown' }), null, NOW)).toBe(true);
    expect(isUsableAccount(createCandidate('a', { paused: true }), null, NOW)).toBe(false);
    expect(isUsableAccount(createCandidate('a', { signIn: 'signed_out' }), null, NOW)).toBe(false);
    expect(isUsableAccount(createCandidate('a', {}, 100), null, NOW)).toBe(false);
  });

  test('a stale reading no longer keeps an account out, and a marked rejection still does', () => {
    const later = NOW + STALE_USAGE_MS + 1;
    const resetsAt = later + 60_000;
    const stale = createCandidate('a', { usage: createUsage([{ usedPercent: 100, resetsAt }]) });
    expect(isUsableAccount(stale, null, NOW)).toBe(false);
    expect(isUsableAccount(stale, null, later)).toBe(true);
    expect(Option.getOrNull(pickAccount(createRequest([stale], { now: later })))).toEqual({
      account: stale,
      reason: null,
      usable: true,
    });
    const rejected = { ...stale, spentUntil: resetsAt };
    expect(Option.getOrNull(resolveCandidateSpentUntil(rejected, null, later))).toBe(resetsAt);
    expect(isUsableAccount(rejected, null, later)).toBe(false);
  });
});

describe('picking an account', () => {
  test('stays on the previous account while it is below its switch threshold', () => {
    const accounts = [createCandidate('a', { isDefault: true }, 10), createCandidate('b', {}, 50)];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { previous: 'b' })))).toEqual({
      account: accounts[1] as AccountCandidate,
      reason: null,
      usable: true,
    });
  });

  test('without a previous account the default is used while it is below its threshold', () => {
    const accounts = [createCandidate('a', {}, 0), createCandidate('b', { isDefault: true }, 50)];
    expect(Option.getOrNull(pickAccount(createRequest(accounts)))?.account.id).toBe('b');
  });

  test('past the threshold the account with the most headroom takes over, with headroom as the reason', () => {
    const accounts = [
      createCandidate('a', { isDefault: true }, 95),
      createCandidate('b', {}, 60),
      createCandidate('c', {}, 20),
      createCandidate('d'),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { previous: 'a' })))).toMatchObject({
      account: { id: 'c' },
      reason: 'headroom',
      usable: true,
    });
  });

  test('past the threshold the account whose weekly limit resets soonest takes over, so what it has left is not lost', () => {
    const weekly = (used: number, resetsIn: number | null) =>
      createUsage([
        {
          id: 'weekly',
          kind: 'weekly',
          label: 'Weekly',
          usedPercent: used,
          resetsAt: resetsIn === null ? null : NOW + resetsIn,
        },
      ]);
    const accounts = [
      createCandidate('a', { isDefault: true, usage: weekly(95, 1_000) }),
      createCandidate('late', { usage: weekly(10, 90_000) }),
      createCandidate('soon', { usage: weekly(60, 15_000) }),
      createCandidate('unknown', { usage: weekly(0, null) }),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { previous: 'a' })))).toMatchObject({
      account: { id: 'soon' },
      reason: 'headroom',
    });
    const noReset = [
      createCandidate('x', { usage: weekly(50, null) }),
      createCandidate('y', { usage: weekly(10, null) }),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(noReset)))?.account.id).toBe('y');
  });

  test('accounts with known headroom rank before unknown ones, and equal ones keep their order', () => {
    const unknownFirst = [createCandidate('x'), createCandidate('y', {}, 30), createCandidate('z', {}, 30)];
    expect(Option.getOrNull(pickAccount(createRequest(unknownFirst)))?.account.id).toBe('y');
    const unknownLast = [createCandidate('y', {}, 30), createCandidate('x')];
    expect(Option.getOrNull(pickAccount(createRequest(unknownLast)))?.account.id).toBe('y');
    const allUnknown = [createCandidate('p'), createCandidate('q')];
    expect(Option.getOrNull(pickAccount(createRequest(allUnknown)))?.account.id).toBe('p');
  });

  test('when every usable account is past its threshold the one with the most headroom is still used', () => {
    const accounts = [createCandidate('a', {}, 97), createCandidate('b', {}, 92)];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { previous: 'a' })))).toMatchObject({
      account: { id: 'b' },
      reason: 'headroom',
      usable: true,
    });
  });

  test('a spent or signed-out previous account names why the work moved', () => {
    const spent = [createCandidate('a', {}, 100), createCandidate('b', {}, 10)];
    expect(Option.getOrNull(pickAccount(createRequest(spent, { previous: 'a' })))?.reason).toBe(
      'usage_limit'
    );
    const signedOut = [createCandidate('a', { signIn: 'signed_out' }), createCandidate('b', {}, 10)];
    expect(Option.getOrNull(pickAccount(createRequest(signedOut, { previous: 'a' })))?.reason).toBe(
      'signed_out'
    );
    expect(Option.getOrNull(pickAccount(createRequest(spent, { previous: 'gone' })))?.reason).toBeNull();
  });

  test('excluded accounts are skipped', () => {
    const accounts = [createCandidate('a', { isDefault: true }), createCandidate('b')];
    expect(
      Option.getOrNull(pickAccount(createRequest(accounts, { exclude: new Set(['a']) })))?.account.id
    ).toBe('b');
  });

  test('a bound account is always used, usable or not, and says it moved the work', () => {
    const accounts = [createCandidate('a', {}, 10), createCandidate('b', {}, 100)];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { bound: 'b', previous: 'a' })))).toEqual({
      account: accounts[1] as AccountCandidate,
      reason: 'bound',
      usable: false,
    });
    expect(
      Option.getOrNull(pickAccount(createRequest(accounts, { bound: 'a', previous: 'a' })))
    ).toMatchObject({
      reason: null,
      usable: true,
    });
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { bound: 'a' })))?.reason).toBeNull();
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { bound: 'removed' })))).toBeNull();
  });

  test('when nothing is usable the signed-in account that frees up first is returned as unusable', () => {
    const accounts = [
      createCandidate('a', { signIn: 'signed_out' }),
      createCandidate('b', { spentUntil: NOW + 50_000 }),
      createCandidate('c', { spentUntil: NOW + 20_000 }),
      createCandidate('d', { paused: true }),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(accounts, { previous: 'b' })))).toEqual({
      account: accounts[2] as AccountCandidate,
      reason: 'usage_limit',
      usable: false,
    });
    const signedOutOnly = [
      createCandidate('a', { signIn: 'signed_out' }),
      createCandidate('b', { signIn: 'signed_out' }),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(signedOutOnly)))?.account.id).toBe('a');
  });

  test('when every account is paused the default is returned, else the first', () => {
    const withDefault = [
      createCandidate('a', { paused: true }),
      createCandidate('b', { paused: true, isDefault: true }),
    ];
    expect(Option.getOrNull(pickAccount(createRequest(withDefault)))).toMatchObject({
      account: { id: 'b' },
      usable: false,
    });
    const withoutDefault = [createCandidate('a', { paused: true }), createCandidate('b', { paused: true })];
    expect(Option.getOrNull(pickAccount(createRequest(withoutDefault)))?.account.id).toBe('a');
  });

  test('the last resort never hands back an account this attempt already tried', () => {
    const accounts = [
      createCandidate('tried', { spentUntil: NOW + 1_000 }),
      createCandidate('other', { signIn: 'signed_out' }),
    ];
    const request = createRequest(accounts, { previous: 'tried', exclude: new Set(['tried']) });
    expect(Option.getOrNull(pickAccount(request))).toMatchObject({ account: { id: 'other' }, usable: false });
    expect(Option.getOrNull(pickAccount({ ...request, exclude: new Set(['tried', 'other']) }))).toBeNull();
  });

  test('without accounts there is nothing to pick', () => {
    expect(Option.getOrNull(pickAccount(createRequest([])))).toBeNull();
  });
});

describe('pool reset', () => {
  test('the pool frees up at the earliest reset of its signed-in, unpaused accounts', () => {
    const accounts = [
      createCandidate('a', { spentUntil: NOW + 50_000 }),
      createCandidate('b', { spentUntil: NOW + 20_000 }),
      createCandidate('c', { paused: true }),
      createCandidate('d', { signIn: 'signed_out' }),
    ];
    expect(Option.getOrNull(resolvePoolResetAt(accounts, null, NOW))).toBe(NOW + 20_000);
  });

  test('a pool with a usable account, or no account to wait for, has no reset', () => {
    expect(
      Option.getOrNull(
        resolvePoolResetAt([createCandidate('a', { spentUntil: NOW + 1 }), createCandidate('b')], null, NOW)
      )
    ).toBeNull();
    expect(
      Option.getOrNull(resolvePoolResetAt([createCandidate('a', { paused: true })], null, NOW))
    ).toBeNull();
    expect(Option.getOrNull(resolvePoolResetAt([], null, NOW))).toBeNull();
  });
});

describe('the next account for the usage glance', () => {
  function summary(id: string, used: number, patch: Partial<AccountSummary> = {}): AccountSummary {
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
      usage: createUsage([{ usedPercent: used }]),
      spentUntil: null,
      runs: 0,
      ...patch,
    };
  }

  test('names the account Shinsa would pick next, with the setting as the threshold an account leaves unset', () => {
    const settings = { ...createSettings(), accountSwitchAt: 80 };
    const accounts = [summary('a', 85, { isDefault: true }), summary('b', 85, { switchAt: 95 })];
    expect(Option.getOrNull(selectNextAccount(accounts, settings, 'opus', NOW))?.id).toBe('b');
    expect(
      Option.getOrNull(selectNextAccount(accounts, { ...settings, accountSwitchAt: 90 }, 'opus', NOW))?.id
    ).toBe('a');
  });

  test('passes over an account with a window used up, even when nothing marked it spent', () => {
    const accounts = [
      summary('spent', 100, { isDefault: true }),
      summary('fresh', 0, { usage: createUsage([]) }),
    ];
    expect(Option.getOrNull(selectNextAccount(accounts, createSettings(), 'opus', NOW))?.id).toBe('fresh');
    expect(Option.getOrNull(selectNextAccount([], createSettings(), 'opus', NOW))).toBeNull();
  });
});
