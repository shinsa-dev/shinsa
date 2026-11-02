import { describe, expect, test } from 'bun:test';
import type { RemoteTeam, RemoteTeamEntry } from '@shinsa/core';
import type { RemoteSnapshot } from '../../src/remote/index.ts';
import { createFakeClient, findSpec, runSpec } from './fixtures.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const BOB = { id: '9', login: 'bob', name: null, avatarUrl: null };

const PLATFORM: RemoteTeam = {
  id: 'team1',
  name: 'Platform',
  owner: MONA,
  role: 'owner',
  members: [{ user: KAI, addedAt: 2 }],
  requests: [{ user: BOB, addedAt: 3 }],
  machines: [],
  createdAt: 1,
};

const OWNED: RemoteTeamEntry = {
  id: 'team1',
  name: 'Platform',
  status: 'member',
  onMachine: true,
  invite: true,
  team: PLATFORM,
};

const JOINED: RemoteTeamEntry = {
  id: 'team2',
  name: 'Growth',
  status: 'member',
  onMachine: false,
  invite: false,
  team: { ...PLATFORM, id: 'team2', name: 'Growth', owner: KAI, role: 'member', members: [], requests: [] },
};

const ASKED: RemoteTeamEntry = {
  id: 'team3',
  name: 'Design',
  status: 'requested',
  onMachine: true,
  invite: false,
  team: null,
};

function createSnapshot(teams: RemoteTeamEntry[], paired = true) {
  return { paired, teams } as unknown as RemoteSnapshot;
}

describe('the teams commands', () => {
  test('list the teams with their owner, members and who asks, and what is missing on this machine', async () => {
    const fake = createFakeClient({ '/api/remote': createSnapshot([OWNED, JOINED, ASKED]) });
    expect((await runSpec(fake, ['teams', 'list'])).text).toBe(
      [
        'Platform (team1), you own it.',
        '  Member: Kai Lane (kai)',
        '  Asks to join: bob',
        'Growth (team2), owned by Kai Lane (kai). Open its link on this machine to show its tasks here.',
        'Design (team3): you asked to join; its owner has not answered yet.',
      ].join('\n')
    );
    expect(findSpec(['teams', 'list']).humanOnly).toBeUndefined();
  });

  test('say how to begin with no team, and with remote access off', async () => {
    const none = createFakeClient({ '/api/remote': createSnapshot([]) });
    expect((await runSpec(none, ['teams', 'list'])).text).toContain('teams create');
    const off = createFakeClient({ '/api/remote': createSnapshot([], false) });
    expect((await runSpec(off, ['teams', 'list'])).text).toContain('remote pair');
  });

  test('create a team, join one and show a team’s link, all left to the human', async () => {
    const fake = createFakeClient({
      '/api/remote': createSnapshot([OWNED]),
      '/api/remote/teams/create': { teamId: 'team1', url: 'https://app.shinsa.dev/share/team#a.b.c' },
      '/api/remote/teams/join': (_path: string, body: unknown) => ({
        status: (body as { url: string }).url.endsWith('member') ? 'member' : 'requested',
      }),
      '/api/remote/teams/link': { url: 'https://app.shinsa.dev/share/team#a.b.c' },
    });
    expect((await runSpec(fake, ['teams', 'create', 'Platform', 'team'])).text).toContain(
      'https://app.shinsa.dev/share/team#a.b.c'
    );
    expect((await runSpec(fake, ['teams', 'join', 'https://x/member'])).text).toContain('add-to-team');
    expect((await runSpec(fake, ['teams', 'join', 'https://x/asked'])).text).toBe(
      'You asked to join. The team’s owner accepts or declines.'
    );
    expect((await runSpec(fake, ['teams', 'link', 'platform'])).text).toContain('asks to join');
    expect(fake.posts).toEqual([
      { path: '/api/remote/teams/create', body: { name: 'Platform team' } },
      { path: '/api/remote/teams/join', body: { url: 'https://x/member' } },
      { path: '/api/remote/teams/join', body: { url: 'https://x/asked' } },
      { path: '/api/remote/teams/link', body: { teamId: 'team1' } },
    ]);
    for (const words of [
      ['teams', 'create'],
      ['teams', 'join'],
      ['teams', 'link'],
      ['teams', 'leave'],
      ['teams', 'accept'],
    ])
      expect(findSpec(words).humanOnly).toBe(true);
  });

  test('accept, decline and remove people by their login, and leave or remove a team by name or id', async () => {
    const reply = createSnapshot([OWNED, JOINED]);
    const fake = createFakeClient({
      '/api/remote': reply,
      '/api/remote/teams/requests/accept': reply,
      '/api/remote/teams/requests/decline': reply,
      '/api/remote/teams/members/remove': reply,
      '/api/remote/teams/leave': reply,
      '/api/remote/teams/remove': reply,
      '/api/remote/teams/link/remove': reply,
      '/api/remote/members/grant': reply,
    });
    expect((await runSpec(fake, ['teams', 'accept', 'Platform', '--login', '@bob'])).text).toContain(
      'in the team now'
    );
    await runSpec(fake, ['teams', 'decline', 'team1', '--login', 'BOB']);
    await runSpec(fake, ['teams', 'remove-member', 'Platform', '--login', 'kai']);
    expect((await runSpec(fake, ['teams', 'leave', 'growth'])).text).toBe('You left the team.');
    await runSpec(fake, ['teams', 'remove', 'Platform']);
    await runSpec(fake, ['teams', 'link-off', 'Platform']);
    expect((await runSpec(fake, ['teams', 'grant', 'Platform', '--login', 'kai'])).text).toContain(
      'can reach this machine now'
    );
    expect(fake.posts.map((post) => [post.path, post.body])).toEqual([
      ['/api/remote/teams/requests/accept', { teamId: 'team1', userId: '9' }],
      ['/api/remote/teams/requests/decline', { teamId: 'team1', userId: '9' }],
      ['/api/remote/teams/members/remove', { teamId: 'team1', userId: '7' }],
      ['/api/remote/teams/leave', { teamId: 'team2' }],
      ['/api/remote/teams/remove', { teamId: 'team1' }],
      ['/api/remote/teams/link/remove', { teamId: 'team1' }],
      ['/api/remote/members/grant', { teamId: 'team1', userId: '7' }],
    ]);
  });

  test('say when no team or nobody matches', async () => {
    const twins = createFakeClient({
      '/api/remote': createSnapshot([OWNED, { ...ASKED, name: 'Platform' }]),
    });
    await expect(runSpec(twins, ['teams', 'leave', 'Platform'])).rejects.toThrow(
      'More than one team is called Platform; name it by its id.'
    );
    await expect(runSpec(twins, ['teams', 'leave', 'Garden'])).rejects.toThrow('No team matches Garden.');
    await expect(runSpec(twins, ['teams', 'accept', 'team1', '--login', 'kai'])).rejects.toThrow(
      'kai has not asked to join this team.'
    );
    await expect(runSpec(twins, ['teams', 'remove-member', 'team3', '--login', 'kai'])).rejects.toThrow(
      'kai is not in this team.'
    );
  });
});
