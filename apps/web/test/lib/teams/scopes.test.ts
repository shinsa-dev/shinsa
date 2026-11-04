import { describe, expect, it } from 'bun:test';
import {
  ACCESS_PRESETS,
  ACCESS_SCOPES,
  DEFAULT_TEAM_SCOPES,
  type RemoteTeam,
  toggleScope,
} from '@shinsa/core';
import {
  describeScopesOwner,
  describeScopesSummary,
  hasOwnScopes,
  listMemberItems,
  listPresetItems,
  resolveChoiceScopes,
  resolveMemberChoice,
  resolveMemberScopes,
  resolveTeamChoice,
  resolveTeammateScopes,
} from '../../../src/lib/teams/scopes.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const TEAM: RemoteTeam = {
  id: 'team1',
  name: 'Platform',
  owner: MONA,
  role: 'owner',
  members: [],
  requests: [],
  machines: [{ id: 'studio', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: null }],
  scopes: DEFAULT_TEAM_SCOPES,
  overrides: [{ userId: '7', scopes: ACCESS_PRESETS.full }],
  createdAt: 1,
};

describe('team scopes in settings', () => {
  it('names the preset a set of scopes matches, or Custom, and counts the actions on', () => {
    expect(resolveTeamChoice(DEFAULT_TEAM_SCOPES)).toBe('collaborate');
    expect(resolveTeamChoice(ACCESS_PRESETS.standard)).toBe('standard');
    expect(resolveTeamChoice(toggleScope(DEFAULT_TEAM_SCOPES, 'fork', false))).toBe('custom');
    expect(describeScopesSummary(DEFAULT_TEAM_SCOPES)).toBe('Collaborate · 5 of 6 scopes');
    expect(describeScopesSummary(ACCESS_PRESETS.standard)).toBe('View only · 0 of 6 scopes');
  });

  it('lists the presets, with Custom only while the scopes are custom', () => {
    expect(listPresetItems('collaborate').map((item) => item.label)).toEqual([
      'View only',
      'Collaborate',
      'Full access',
    ]);
    expect(listPresetItems('custom').at(-1)?.label).toBe('Custom');
  });

  it('says only the owner changes them, to anyone else', () => {
    expect(describeScopesOwner(TEAM)).toBeNull();
    expect(describeScopesOwner(TEAM, false)).toBe(
      'Add one of your machines to this browser to change these.'
    );
    expect(describeScopesOwner({ ...TEAM, role: 'member' })).toBe('Only Mona Lisa changes these.');
    expect(describeScopesOwner({ ...TEAM, role: 'member', owner: { ...MONA, name: null } })).toBe(
      'Only mona changes these.'
    );
  });

  it('reads one person’s scopes as the team’s or their own, and turns a choice into what to send', () => {
    expect(resolveMemberChoice(TEAM, '7')).toBe('full');
    expect(resolveMemberChoice(TEAM, '8')).toBe('team');
    expect(resolveMemberScopes(TEAM, '8')).toEqual(DEFAULT_TEAM_SCOPES);
    expect(hasOwnScopes(TEAM, '7')).toBe(true);
    expect(hasOwnScopes(TEAM, '8')).toBe(false);
    expect(listMemberItems(TEAM, 'team').map((item) => item.label)).toEqual([
      'Team’s (Collaborate)',
      'View only',
      'Collaborate',
      'Full access',
    ]);
    expect(listMemberItems(TEAM, 'custom').at(-1)?.value).toBe('custom');
    expect(resolveChoiceScopes('team', DEFAULT_TEAM_SCOPES)).toBeNull();
    expect(resolveChoiceScopes('full', DEFAULT_TEAM_SCOPES)).toEqual(ACCESS_PRESETS.full);
    expect(resolveChoiceScopes('custom', ACCESS_PRESETS.standard)).toEqual(ACCESS_PRESETS.standard);
  });

  it('gives a teammate machine the scopes of every team it is in, and none when it is in no team', () => {
    expect(resolveTeammateScopes([TEAM], 'studio', '7')).toEqual(ACCESS_SCOPES);
    expect(resolveTeammateScopes([TEAM], 'studio', '8')).toEqual(DEFAULT_TEAM_SCOPES);
    expect(resolveTeammateScopes([TEAM], 'laptop', '7')).toEqual([]);
  });
});
