import { describe, expect, it } from 'bun:test';
import { describePresence, markViewerPresent } from '../../../src/lib/teams/presence.ts';

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

describe('markViewerPresent', () => {
  it('shows you online on the page you are using, and leaves everyone else as reported', () => {
    const away = new Map([
      ['me', { userId: 'me', status: 'away' as const, seenAt: 1 }],
      ['kai', { userId: 'kai', status: 'offline' as const, seenAt: 2 }],
    ]);
    const marked = markViewerPresent(away, 'me', NOW);
    expect(marked.get('me')).toEqual({ userId: 'me', status: 'online', seenAt: NOW });
    expect(marked.get('kai')?.status).toBe('offline');
    expect(markViewerPresent(away, null, NOW)).toBe(away);
    expect(markViewerPresent(away, 'stranger', NOW)).toBe(away);
    expect(markViewerPresent(marked, 'me', NOW)).toBe(marked);
  });
});
