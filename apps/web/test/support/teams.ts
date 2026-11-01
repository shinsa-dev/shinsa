import type { RemoteTeam, RemoteTeamEntry } from '@shinsa/core';

export const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

export const KAI = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };

export const BOB = { id: '9', login: 'bob', name: null, avatarUrl: null };

export const TEAM_URL = `https://app.shinsa.dev/share/team#team1.invite-1.${'A'.repeat(43)}`;

export function createTeam(overrides: Partial<RemoteTeam> = {}): RemoteTeam {
  return {
    id: 'team1',
    name: 'Platform',
    owner: MONA,
    role: 'owner',
    members: [{ user: KAI, addedAt: Date.now() - 3_600_000 }],
    requests: [{ user: BOB, addedAt: Date.now() - 60_000 }],
    machines: [],
    createdAt: Date.now() - 86_400_000,
    ...overrides,
  };
}

export function createTeamEntry(overrides: Partial<RemoteTeamEntry> = {}): RemoteTeamEntry {
  const team = overrides.team === undefined ? createTeam() : overrides.team;
  return {
    id: team?.id ?? 'team1',
    name: team?.name ?? 'Platform',
    status: team ? 'member' : 'requested',
    onMachine: true,
    invite: true,
    team,
    ...overrides,
  };
}
