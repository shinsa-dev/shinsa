import { describe, expect, it } from 'bun:test';
import { listHostedTeams } from '@/lib/teams/hosted.ts';
import { createTeam, KAI, MONA } from '../../support/teams.ts';

describe('the hosted teams on app.shinsa.dev', () => {
  it('reads the hosted teams with whether this browser holds each one’s key, and who is looking', async () => {
    const platform = createTeam();
    const design = createTeam({ id: 'team2', name: 'Design', owner: KAI, role: 'member' });
    const read = await listHostedTeams({
      dashboard: {
        listTeams: () => Promise.resolve([platform, design]),
        readSession: () => Promise.resolve({ user: MONA }),
      },
      teamKeys: {
        selectTeamKey: (teamId) =>
          Promise.resolve(teamId === 'team1' ? { teamId, name: 'Platform', key: 'k', joinedAt: 0 } : null),
      },
    });
    expect(read).toEqual({
      viewerId: MONA.id,
      teams: [
        { team: platform, hasKey: true },
        { team: design, hasKey: false },
      ],
    });
    const signedOut = await listHostedTeams({
      dashboard: { listTeams: () => Promise.resolve([]), readSession: () => Promise.resolve({ user: null }) },
      teamKeys: { selectTeamKey: () => Promise.resolve(null) },
    });
    expect(signedOut).toEqual({ viewerId: null, teams: [] });
  });
});
