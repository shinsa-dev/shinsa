import { describe, expect, it } from 'bun:test';
import type { RemoteAccess, RemoteDevice } from '@shinsa/core';
import {
  describeUserHandle,
  describeUserName,
  resolveUserInitial,
  selectDeviceMember,
} from '@/lib/remote/users.ts';

const NAMED = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const BARE = { id: '1', login: 'mona', name: null, avatarUrl: null };

const DEVICE: RemoteDevice = {
  publicKey: 'd',
  name: 'Phone',
  enrolledAt: 0,
  lastSeenAt: null,
  userId: '7',
};

describe('a GitHub user on screen', () => {
  it('goes by their name with the login beside it, or by the login alone', () => {
    expect(describeUserName(NAMED)).toBe('Kai Lane');
    expect(describeUserHandle(NAMED)).toBe('@kai');
    expect(describeUserName(BARE)).toBe('@mona');
    expect(describeUserHandle(BARE)).toBeNull();
  });

  it('stands in for a missing avatar with the first letter of what it shows', () => {
    expect(resolveUserInitial(NAMED)).toBe('K');
    expect(resolveUserInitial(BARE)).toBe('M');
  });

  it('finds the member who added a device, never the owner or a stranger', () => {
    const access: RemoteAccess = { owner: BARE, members: [{ user: NAMED, addedAt: 0 }] };
    expect(selectDeviceMember(access, DEVICE)).toBe(NAMED);
    expect(selectDeviceMember(access, { ...DEVICE, userId: '1' })).toBeNull();
    expect(selectDeviceMember(null, DEVICE)).toBeNull();
  });
});
