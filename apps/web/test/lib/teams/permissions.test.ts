import { describe, expect, it } from 'bun:test';
import { DEFAULT_TEAM_PERMISSIONS, type RemoteTeam } from '@shinsa/core';
import {
  createOverrideChange,
  describePermissionsOwner,
  describePermissionsSummary,
  hasOwnRights,
  listOverrideItems,
  PERMISSION_ROWS,
  resolveOverrideChoice,
} from '../../../src/lib/teams/permissions.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const TEAM: RemoteTeam = {
  id: 'team1',
  name: 'Platform',
  owner: MONA,
  role: 'owner',
  members: [],
  requests: [],
  machines: [],
  permissions: DEFAULT_TEAM_PERMISSIONS,
  overrides: [
    { userId: '7', permissions: { message: true, share: false } },
    { userId: '8', permissions: {} },
  ],
  createdAt: 1,
};

describe('team permissions in settings', () => {
  it('names every right once, and counts how many the team has on', () => {
    expect(PERMISSION_ROWS.map((row) => row.name)).toEqual([
      'act',
      'takeOver',
      'share',
      'services',
      'message',
    ]);
    expect(describePermissionsSummary(DEFAULT_TEAM_PERMISSIONS)).toBe('4 of 5 on');
  });

  it('says only the owner changes them, to anyone else', () => {
    expect(describePermissionsOwner(TEAM)).toBeNull();
    expect(describePermissionsOwner({ ...TEAM, role: 'member' })).toBe('Only Mona Lisa changes these.');
    expect(describePermissionsOwner({ ...TEAM, role: 'member', owner: { ...MONA, name: null } })).toBe(
      'Only mona changes these.'
    );
  });

  it('reads one person’s rights as the team’s, on or off, and writes a choice back as a change', () => {
    expect(resolveOverrideChoice(TEAM, '7', 'message')).toBe('on');
    expect(resolveOverrideChoice(TEAM, '7', 'share')).toBe('off');
    expect(resolveOverrideChoice(TEAM, '7', 'act')).toBe('team');
    expect(resolveOverrideChoice(TEAM, '9', 'act')).toBe('team');
    expect(createOverrideChange('message', 'team')).toEqual({ message: null });
    expect(createOverrideChange('share', 'on')).toEqual({ share: true });
    expect(createOverrideChange('act', 'off')).toEqual({ act: false });
    expect(listOverrideItems(false).map((item) => item.label)).toEqual(['Team setting (Off)', 'On', 'Off']);
    expect(listOverrideItems(true)[0]?.label).toBe('Team setting (On)');
  });

  it('marks who has rights of their own', () => {
    expect(hasOwnRights(TEAM, '7')).toBe(true);
    expect(hasOwnRights(TEAM, '8')).toBe(false);
    expect(hasOwnRights(TEAM, '9')).toBe(false);
  });
});
