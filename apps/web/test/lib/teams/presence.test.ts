import { describe, expect, it } from 'bun:test';
import { describePresence } from '../../../src/lib/teams/presence.ts';

const NOW = 1_800_000_000_000;

describe('describePresence', () => {
  it('says online plainly, and when an away or offline person was last seen', () => {
    expect(describePresence({ userId: 'u', status: 'online', seenAt: NOW }, NOW)).toBe('Online');
    expect(describePresence({ userId: 'u', status: 'away', seenAt: NOW - 600_000 }, NOW)).toBe(
      'Away · Seen 10m ago'
    );
    expect(describePresence({ userId: 'u', status: 'offline', seenAt: null }, NOW)).toBe('Offline');
  });
});
