import { describe, expect, test } from 'bun:test';
import {
  type AccountSummary,
  type AccountUsage,
  createSettings,
  listModelRoom,
  ROUTED_FAMILIES,
  type UsageWindow,
} from '../../src/index.ts';

const NOW = 1_000_000;
const SETTINGS = createSettings();

function createUsage(windows: Partial<UsageWindow>[]): AccountUsage {
  return {
    status: windows.length > 0 ? 'ok' : 'unknown',
    windows: windows.map((window) => ({
      id: 'seven_day',
      kind: 'weekly',
      label: 'Weekly limit',
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

function fable(usedPercent: number): Partial<UsageWindow> {
  return { id: 'weekly:fable', kind: 'model', label: 'Fable', model: 'fable', usedPercent };
}

function summary(id: string, usage: AccountUsage, patch: Partial<AccountSummary> = {}): AccountSummary {
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
    usage,
    spentUntil: null,
    runs: 0,
    ...patch,
  };
}

function roomOf(accounts: AccountSummary[]) {
  return Object.fromEntries(listModelRoom(accounts, SETTINGS, NOW).map((room) => [room.family, room]));
}

describe('the room each routed model has', () => {
  test('covers every model routing can pick, once', () => {
    expect([...ROUTED_FAMILIES].sort()).toEqual(['fable', 'opus', 'sonnet']);
  });

  test('records nothing without a signed-in account', () => {
    expect(listModelRoom([], SETTINGS, NOW)).toEqual([]);
    expect(listModelRoom([summary('a', createUsage([]), { signIn: 'signed_out' })], SETTINGS, NOW)).toEqual(
      []
    );
  });

  test('a model spent on one account keeps the best room the others leave', () => {
    const room = roomOf([
      summary('a', createUsage([{ usedPercent: 40 }, fable(100)])),
      summary('b', createUsage([{ usedPercent: 70 }, fable(20)])),
    ]);
    expect(room.fable).toMatchObject({ family: 'fable', usable: true, left: 30 });
    expect(room.opus).toMatchObject({ family: 'opus', usable: true, left: 60 });
    expect(room.fable?.accounts).toEqual([
      { account: 'a', usable: false, left: 0 },
      { account: 'b', usable: true, left: 30 },
    ]);
  });

  test('a model spent on every account, or marked spent for it, is not usable', () => {
    const room = roomOf([
      summary('a', createUsage([{ usedPercent: 40 }, fable(100)])),
      summary('b', createUsage([{ usedPercent: 10 }]), { spentUntil: NOW + 60_000, spentModel: 'fable' }),
    ]);
    expect(room.fable).toMatchObject({ family: 'fable', usable: false, left: null });
    expect(room.sonnet).toMatchObject({ family: 'sonnet', usable: true, left: 90 });
  });

  test('paused and signed-out accounts give no room, and an unread account is usable with unknown room', () => {
    const room = roomOf([
      summary('a', createUsage([{ usedPercent: 10 }]), { paused: true }),
      summary('b', createUsage([{ usedPercent: 10 }]), { signIn: 'unknown' }),
      summary('c', createUsage([])),
    ]);
    expect(room.opus).toMatchObject({ family: 'opus', usable: true, left: null });
  });
});
