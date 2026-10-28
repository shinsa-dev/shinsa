import { describe, expect, it } from 'bun:test';
import {
  type AccountSummary,
  createSettings,
  pickAccount,
  resolveAccountCandidate,
  type Settings,
} from '@shinsa/core';
import {
  describeAccountStatus,
  describeResetsIn,
  describeUsageChecked,
  describeUsageDetail,
  isNextAccount,
  isNextProvider,
  listProviderGlances,
  listUsageRows,
  resolveAccountHeader,
  resolveAccountStatus,
  resolveUsageGlance,
  resolveUsageModel,
  resolveUsageText,
  resolveUsageTone,
  selectGlanceRow,
} from '@/lib/accounts/usage.ts';
import { createAccount, createProviderLogin, createSnapshot, createWindow } from '../../support/accounts.ts';
import { NOW } from '../../support/state.ts';

const HOUR = 3_600_000;

const SETTINGS = createSettings();

function usage(...windows: ReturnType<typeof createWindow>[]) {
  return { status: 'ok' as const, windows, detail: null, checkedAt: NOW, source: 'read' as const };
}

function at(id: string, usedPercent: number, extra: Partial<AccountSummary> = {}) {
  return createAccount({
    id,
    ...extra,
    usage: usage(createWindow({ id: `${id}-s`, usedPercent, resetsAt: NOW + HOUR })),
  });
}

describe('usage rows', () => {
  it('colours usage quiet below 75%, amber from 75% and red from 90%', () => {
    expect(resolveUsageTone(74)).toBe('neutral');
    expect(resolveUsageTone(75)).toBe('amber');
    expect(resolveUsageTone(90)).toBe('red');
    expect(resolveUsageText(74)).toBe('text-fg-3');
    expect(resolveUsageText(75)).toBe('text-amber-text');
    expect(resolveUsageText(90)).toBe('text-red-text');
  });

  it('lists every window as a rounded, clamped percentage with its reset', () => {
    const account = createAccount({
      id: 'a',
      usage: usage(
        createWindow({ id: 's', usedPercent: 41.6 }),
        createWindow({
          id: 'w',
          kind: 'weekly',
          label: 'Weekly · All models',
          usedPercent: 120,
          resetsAt: null,
        })
      ),
    });
    expect(listUsageRows(account)).toEqual([
      { id: 's', label: '5-hour limit', percent: 42, tone: 'neutral', resetsAt: NOW + 3 * HOUR },
      { id: 'w', label: 'Weekly · All models', percent: 100, tone: 'red', resetsAt: null },
    ]);
  });

  it('glances at the fullest window that applies to the agent’s model, so a nearly spent week never reads low', () => {
    const settings: Settings = { ...SETTINGS, agentModels: { agent: 'claude-fable-1' } };
    expect(resolveUsageModel(settings)).toBe('claude-fable-1');
    const account = createAccount({
      id: 'a',
      usage: usage(
        createWindow({ id: 's', usedPercent: 0 }),
        createWindow({ id: 'w', kind: 'weekly', label: 'Weekly · All models', usedPercent: 70 }),
        createWindow({ id: 'f', kind: 'model', label: 'Weekly · Fable', model: 'fable', usedPercent: 92 }),
        createWindow({ id: 'o', kind: 'model', label: 'Weekly · Opus', model: 'opus', usedPercent: 99 })
      ),
    });
    expect(selectGlanceRow(account, 'claude-fable-1')).toMatchObject({
      id: 'f',
      label: 'Weekly · Fable',
      percent: 92,
      tone: 'red',
    });
    const spent = createAccount({
      id: 'b',
      usage: usage(
        createWindow({ id: 's', usedPercent: 12 }),
        createWindow({ id: 'w', kind: 'weekly', label: 'Weekly · All models', usedPercent: 100 })
      ),
    });
    expect(selectGlanceRow(spent, 'claude-fable-1')).toMatchObject({ id: 'w', percent: 100, tone: 'red' });
  });

  it('glances at the 5-hour window when it is the fullest, or as full as the fullest once rounded', () => {
    const fuller = createAccount({
      id: 'a',
      usage: usage(
        createWindow({ id: 'w', kind: 'weekly', label: 'Weekly · All models', usedPercent: 30 }),
        createWindow({ id: 's', usedPercent: 60 })
      ),
    });
    expect(selectGlanceRow(fuller, 'claude-fable-1')).toMatchObject({
      id: 's',
      label: '5-hour limit',
      percent: 60,
    });
    const tied = createAccount({
      id: 'b',
      usage: usage(
        createWindow({ id: 'w', kind: 'weekly', label: 'Weekly · All models', usedPercent: 40.2 }),
        createWindow({ id: 's', usedPercent: 39.8 })
      ),
    });
    expect(selectGlanceRow(tied, 'claude-fable-1')).toMatchObject({ id: 's', percent: 40 });
    const fresh = createAccount({
      id: 'c',
      usage: usage(
        createWindow({ id: 'w', kind: 'weekly', label: 'Weekly · All models', usedPercent: 0 }),
        createWindow({ id: 's', usedPercent: 0 })
      ),
    });
    expect(selectGlanceRow(fresh, 'claude-fable-1')).toMatchObject({ id: 's' });
    expect(selectGlanceRow(createAccount({ id: 'd', usage: usage() }), 'opus')).toBeNull();
  });
});

describe('the usage glance follows the server’s pick', () => {
  function pickedByServer(accounts: AccountSummary[], settings: Settings) {
    return pickAccount({
      accounts: accounts.map((account) => resolveAccountCandidate(account, settings)),
      bound: null,
      previous: null,
      model: resolveUsageModel(settings),
      exclude: new Set(),
      now: NOW,
    })?.account.id;
  }

  it('glances at the account the server picks when the default is over its own threshold', () => {
    const settings: Settings = { ...SETTINGS, accountSwitchAt: 80 };
    const accounts = [
      at('a', 85, { isDefault: true }),
      at('b', 85, { switchAt: 95 }),
      at('c', 70, { switchAt: 60 }),
    ];
    const glance = resolveUsageGlance(createSnapshot({ accounts }), settings, NOW);
    expect(glance?.account?.id).toBe(pickedByServer(accounts, settings));
  });

  it('glances at the account that resets first when every one is used up, as the server does', () => {
    const settings: Settings = { ...SETTINGS, accountSwitchAt: 100 };
    const later = at('later', 100, { isDefault: true });
    const sooner = createAccount({
      id: 'sooner',
      usage: usage(createWindow({ id: 'sooner-s', usedPercent: 100, resetsAt: NOW + 60_000 })),
    });
    const accounts = [later, sooner];
    const glance = resolveUsageGlance(createSnapshot({ accounts }), settings, NOW);
    expect(glance?.account?.id).toBe('sooner');
    expect(glance?.account?.id).toBe(pickedByServer(accounts, settings));
  });

  it('glances at the next account and its 5-hour window, and at nothing without accounts', () => {
    const snapshot = createSnapshot({ accounts: [at('a', 42, { isDefault: true })] });
    expect(resolveUsageGlance(snapshot, SETTINGS, NOW)).toMatchObject({
      provider: 'claude',
      account: { id: 'a' },
      row: { percent: 42 },
    });
    expect(resolveUsageGlance(createSnapshot(), SETTINGS, NOW)).toBeNull();
    expect(resolveUsageGlance(null, SETTINGS, NOW)).toBeNull();
  });

  it('glances at Codex’s fullest window when it does the work, or when it is the only provider with a reading', () => {
    const codex = createProviderLogin();
    const both = createSnapshot({ accounts: [at('a', 42, { isDefault: true })], providers: [codex] });
    expect(resolveUsageGlance(both, SETTINGS, NOW)).toMatchObject({
      provider: 'claude',
      row: { percent: 42 },
    });
    const onCodex: Settings = { ...SETTINGS, defaultProvider: 'codex' };
    expect(resolveUsageGlance(both, onCodex, NOW)).toEqual({
      provider: 'codex',
      account: null,
      row: expect.objectContaining({ id: 'seven_day', label: 'Weekly limit', percent: 64 }),
    });
    expect(resolveUsageGlance(createSnapshot({ providers: [codex] }), SETTINGS, NOW)).toMatchObject({
      provider: 'codex',
    });
    const unread = createSnapshot({ providers: [{ ...codex, usage: undefined }] });
    expect(resolveUsageGlance(unread, onCodex, NOW)).toBeNull();
  });
});

describe('every provider with a reading of its own', () => {
  it('shows its account, its fullest window and whether it is out of usage or signed out', () => {
    const spent = createProviderLogin({
      email: null,
      usage: {
        status: 'ok',
        windows: [createWindow({ id: 'seven_day', kind: 'weekly', usedPercent: 100, resetsAt: NOW + HOUR })],
        detail: null,
        checkedAt: NOW,
        source: 'read',
      },
    });
    const [glance] = listProviderGlances(createSnapshot({ providers: [spent] }), NOW);
    expect(glance).toMatchObject({
      name: { icon: 'IconOpenaiCodex', label: 'Codex' },
      row: { percent: 100, tone: 'red' },
      status: { label: 'Out of usage', tone: 'red', until: NOW + HOUR },
    });
    const out = createProviderLogin({ status: 'signed_out' });
    expect(listProviderGlances(createSnapshot({ providers: [out] }), NOW)[0]?.status).toEqual({
      label: 'Needs sign-in',
      tone: 'orange',
      until: null,
    });
    expect(
      listProviderGlances(createSnapshot({ providers: [createProviderLogin()] }), NOW)[0]?.status
    ).toBeNull();
    expect(listProviderGlances(null, NOW)).toEqual([]);
  });
});

describe('the account the next turn uses', () => {
  it('marks the Claude account the glance picked, or the provider when it does the work', () => {
    const account = at('a', 10);
    const codex = createProviderLogin();
    const onClaude = { provider: 'claude', account, row: null };
    expect(isNextAccount(onClaude, account)).toBe(true);
    expect(isNextAccount(onClaude, at('b', 10))).toBe(false);
    expect(isNextProvider(onClaude, codex)).toBe(false);
    const onCodex = { provider: 'codex', account: null, row: null };
    expect(isNextAccount(onCodex, account)).toBe(false);
    expect(isNextProvider(onCodex, codex)).toBe(true);
    expect(isNextProvider(onCodex, { ...codex, provider: 'other' })).toBe(false);
  });
});

describe('a Claude account’s header in Agent usage', () => {
  it('names the account with its provider, its plan, the default mark, its status and when it was read', () => {
    const account = createAccount({
      id: 'a',
      plan: 'max',
      isDefault: true,
      paused: true,
      usage: { status: 'ok', windows: [], detail: null, checkedAt: NOW - 60_000, source: 'read' },
    });
    expect(resolveAccountHeader(account, 'opus', NOW)).toEqual({
      name: { icon: 'IconClaudeai', label: 'Claude · a@example.com' },
      detail: 'Max',
      isDefault: true,
      status: { label: 'Paused', tone: 'neutral', until: null },
      checkedAt: NOW - 60_000,
    });
    expect(resolveAccountHeader(createAccount({ id: 'b', plan: null }), 'opus', NOW).detail).toBeNull();
  });
});

describe('the glance’s words', () => {
  it('gives the server’s detail, or says nothing came back yet', () => {
    const account = at('a', 10);
    expect(describeUsageDetail(account)).toBe('No usage reported yet.');
    const blocked = createAccount({
      id: 'b',
      usage: {
        status: 'unavailable',
        windows: [],
        detail: 'Usage is not available.',
        checkedAt: NOW,
        source: 'read',
      },
    });
    expect(describeUsageDetail(blocked)).toBe('Usage is not available.');
  });
});

describe('reset times', () => {
  it('says how long until a window resets', () => {
    expect(describeResetsIn(NOW + 3 * HOUR, NOW)).toBe('Resets in 3h');
    expect(describeResetsIn(NOW + 20_000, NOW)).toBe('Resets in under a minute');
    expect(describeResetsIn(NOW - 1, NOW)).toBe('Resets now');
    expect(describeResetsIn(NOW + 30 * 24 * HOUR, NOW)).toMatch(/^Resets on [A-Z][a-z]{2} \d+$/);
  });

  it('says when the usage was last read', () => {
    expect(describeUsageChecked(NOW - 2 * 60_000, NOW)).toBe('Updated 2m ago');
  });
});

describe('account status', () => {
  it('says what keeps an account from work, most pressing first', () => {
    expect(
      resolveAccountStatus(createAccount({ id: 'a', signIn: 'signed_out', paused: true }), 'opus', NOW)
    ).toEqual({ label: 'Needs sign-in', tone: 'orange', until: null });
    expect(resolveAccountStatus(createAccount({ id: 'a', paused: true }), 'opus', NOW)?.label).toBe('Paused');
    expect(resolveAccountStatus(createAccount({ id: 'a', spentUntil: NOW + HOUR }), 'opus', NOW)).toEqual({
      label: 'Out of usage',
      tone: 'red',
      until: NOW + HOUR,
    });
    expect(resolveAccountStatus(createAccount({ id: 'a', spentUntil: NOW - 1 }), 'opus', NOW)).toBeNull();
  });

  it('reads an account at 100% of a window as out of usage until that window resets', () => {
    expect(resolveAccountStatus(at('a', 100), 'opus', NOW)).toEqual({
      label: 'Out of usage',
      tone: 'red',
      until: NOW + HOUR,
    });
  });

  it('adds the moment an account is out of usage until', () => {
    const morning = new Date(NOW).setHours(9, 0, 0, 0);
    expect(
      describeAccountStatus({ label: 'Out of usage', tone: 'red', until: morning + HOUR }, morning)
    ).toBe('Out of usage until 10:00 AM');
    expect(describeAccountStatus({ label: 'Paused', tone: 'neutral', until: null }, morning)).toBe('Paused');
  });
});
