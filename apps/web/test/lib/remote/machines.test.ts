import { describe, expect, it } from 'bun:test';
import type { RemoteInstance } from '@shinsa/core';
import { describeMachine } from '@/lib/remote/machines.ts';

const NOW = Date.UTC(2026, 9, 30, 12);

const STUDIO: RemoteInstance = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd',
  online: true,
  lastSeenAt: NOW,
  createdAt: 0,
};

describe('a machine on the dashboard', () => {
  it('opens only when it is online and this browser was added to it', () => {
    expect(describeMachine(STUDIO, true, NOW)).toMatchObject({
      status: 'Online',
      access: 'Added in this browser',
      canOpen: true,
    });
    expect(describeMachine(STUDIO, false, NOW).canOpen).toBe(false);
    expect(describeMachine({ ...STUDIO, online: false }, true, NOW).canOpen).toBe(false);
  });

  it('says when it was last seen, or that it never connected', () => {
    expect(
      describeMachine({ ...STUDIO, online: false, lastSeenAt: NOW - 3 * 60_000 }, true, NOW).status
    ).toBe('Last seen 3m ago');
    expect(describeMachine({ ...STUDIO, online: false, lastSeenAt: null }, true, NOW).status).toBe(
      'Never connected'
    );
  });
});
