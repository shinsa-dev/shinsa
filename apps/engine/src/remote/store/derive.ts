import type { RemoteTeamEntry, SharedPerson } from '@shinsa/core';
import type { RemoteFile } from './schema.ts';

export function createRemoteFile(): RemoteFile {
  return {
    version: 1,
    machine: null,
    signing: null,
    credentials: null,
    owner: null,
    enabled: false,
    devices: [],
    access: null,
    link: null,
    requests: [],
    guests: [],
    handoffs: [],
    teams: [],
    teamKeys: [],
    grants: [],
    extras: [],
    relayDevices: [],
  };
}

export function listTeamEntries(file: RemoteFile): RemoteTeamEntry[] {
  const keys = new Map(file.teamKeys.map((stored) => [stored.teamId, stored]));
  const known = file.teams.map((team) => ({
    id: team.id,
    name: team.name,
    status: 'member' as const,
    onMachine: keys.has(team.id),
    invite: team.role === 'owner' && Boolean(keys.get(team.id)?.invite),
    team,
    extras: file.extras
      .filter((extra) => extra.teamId === team.id)
      .map(({ userId, scopes }) => ({ userId, scopes })),
  }));
  const asked = file.teamKeys
    .filter((stored) => !file.teams.some((team) => team.id === stored.teamId))
    .map((stored) => ({
      id: stored.teamId,
      name: stored.name,
      status: 'requested' as const,
      onMachine: true,
      invite: false,
      team: null,
      extras: [],
    }));
  return [...known, ...asked];
}

export function resolveOwnerProfile(file: RemoteFile): SharedPerson | null {
  const owner = file.access?.owner;
  if (!(owner && file.owner && owner.login.toLowerCase() === file.owner.toLowerCase())) return null;
  return { name: owner.name, avatarUrl: owner.avatarUrl };
}
