import { describe, expect, test } from 'bun:test';
import type { RemoteTeam } from '@shinsa/core';
import { Presence } from '../../src/remote/presence.ts';

const TEAM: Pick<RemoteTeam, 'owner' | 'members'> = {
  owner: { id: 'mona', login: 'mona', name: null, avatarUrl: null },
  members: [
    { user: { id: 'kai', login: 'kai', name: null, avatarUrl: null }, addedAt: 1 },
    { user: { id: 'tess', login: 'tess', name: null, avatarUrl: null }, addedAt: 2 },
  ],
};

describe('presence on this machine', () => {
  test('the machine’s owner is online or away; a teammate is online while any view is open, then last seen', () => {
    let now = 10;
    const presence = new Presence(() => now);
    const changes: number[] = [];
    const unsubscribe = presence.subscribe(() => changes.push(now));
    expect(presence.listTeam(TEAM, 'mona')).toEqual([{ userId: 'mona', status: 'away', seenAt: null }]);
    presence.openViewer('kai');
    presence.openViewer('kai');
    now = 20;
    presence.closeViewer('kai');
    expect(presence.listTeam(TEAM, 'mona')[1]).toEqual({ userId: 'kai', status: 'online', seenAt: 20 });
    now = 30;
    presence.closeViewer('kai');
    presence.closeViewer('kai');
    presence.closeViewer('tess');
    expect(presence.listTeam(TEAM, 'mona')).toEqual([
      { userId: 'mona', status: 'away', seenAt: null },
      { userId: 'kai', status: 'offline', seenAt: 30 },
    ]);
    presence.recordOwner({ active: true, seenAt: 25 });
    presence.recordOwner({ active: true, seenAt: 25 });
    expect(presence.listTeam(TEAM, 'mona')[0]).toEqual({ userId: 'mona', status: 'online', seenAt: 25 });
    expect(changes).toEqual([10, 30, 30]);
    unsubscribe();
    presence.openViewer('tess');
    expect(changes).toHaveLength(3);
  });
});
