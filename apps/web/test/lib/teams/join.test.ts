import { afterEach, describe, expect, it } from 'bun:test';
import type { TeamJoinResponse } from '@shinsa/core';
import type { KeyValueStore } from '@/lib/remote/devices.ts';
import {
  clearTeamJoinFragment,
  createTeamKeyStore,
  requestTeamJoin,
  selectTeamJoinFragment,
  stashTeamJoinFragment,
} from '@/lib/teams/join.ts';
import { KAI } from '../../support/teams.ts';

const KEY = 'A'.repeat(43);

const FRAGMENT = { teamId: 'team1', invite: 'invite-1', key: KEY };

function createMemoryStore(): KeyValueStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    read: (key) => Promise.resolve(values.get(key)),
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    listKeys: () => Promise.resolve([...values.keys()]),
  };
}

function answer(overrides: Partial<TeamJoinResponse> = {}) {
  const response: TeamJoinResponse = {
    teamId: 'team1',
    name: 'Platform',
    owner: KAI,
    status: 'requested',
    ...overrides,
  };
  return { joinTeam: () => Promise.resolve(response) };
}

afterEach(() => sessionStorage.clear());

describe('a team link opened on app.shinsa.dev', () => {
  it('keeps the link through sign-in, and only a whole one', () => {
    stashTeamJoinFragment(sessionStorage, '#nope');
    expect(selectTeamJoinFragment(sessionStorage)).toBeNull();
    stashTeamJoinFragment(sessionStorage, `#team1.invite-1.${KEY}`);
    expect(selectTeamJoinFragment(sessionStorage)).toEqual(FRAGMENT);
    clearTeamJoinFragment(sessionStorage);
    expect(selectTeamJoinFragment(sessionStorage)).toBeNull();
  });

  it('asks to join and keeps the team’s key in this browser, keeping when it first joined', async () => {
    const store = createMemoryStore();
    const teamKeys = createTeamKeyStore(store);
    const result = await requestTeamJoin(FRAGMENT, { dashboard: answer(), teamKeys, now: () => 5 });
    expect(result).toEqual({ name: 'Platform', owner: 'Kai Lane', status: 'requested' });
    expect(await teamKeys.selectTeamKey('team1')).toEqual({
      teamId: 'team1',
      name: 'Platform',
      key: KEY,
      joinedAt: 5,
    });
    await requestTeamJoin(FRAGMENT, { dashboard: answer({ status: 'member' }), teamKeys, now: () => 9 });
    expect((await teamKeys.selectTeamKey('team1'))?.joinedAt).toBe(5);
  });

  it('refuses a link whose invite belongs to another team, and reads nothing it did not write', async () => {
    const store = createMemoryStore();
    const teamKeys = createTeamKeyStore(store);
    await expect(
      requestTeamJoin(FRAGMENT, { dashboard: answer({ teamId: 'other' }), teamKeys })
    ).rejects.toThrow('does not match its team');
    expect(store.values.size).toBe(0);
    store.values.set('team:team2', { teamId: 'team1', name: 'x', key: 'k', joinedAt: 1 });
    store.values.set('team:team3', 'garbage');
    expect(await teamKeys.selectTeamKey('team2')).toBeNull();
    expect(await teamKeys.selectTeamKey('team3')).toBeNull();
  });
});
