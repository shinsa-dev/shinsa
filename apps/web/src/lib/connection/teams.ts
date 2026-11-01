import { listTeamProjectIds, type RemoteSnapshot, type ShinsaState, type TeamJoinStatus } from '@shinsa/core';
import { requestJson } from '@/lib/connection/http.ts';
import { connection, sendCommand } from '@/lib/connection/socket.ts';
import { listTeamProjectCommands } from '@/lib/teams/settings.ts';

async function act(path: string, body: unknown) {
  const snapshot = await requestJson<RemoteSnapshot>(`/api/remote/teams${path}`, body);
  connection.replaceRemote(snapshot);
  return snapshot;
}

async function writeTeamProjects(state: ShinsaState, teamId: string, projectIds: readonly string[]) {
  for (const command of listTeamProjectCommands(state, teamId, projectIds)) await sendCommand(command);
}

export const TEAM_ACTIONS = {
  create: async (state: ShinsaState, name: string, projectIds: readonly string[]) => {
    const created = await requestJson<{ teamId: string; url: string }>('/api/remote/teams/create', { name });
    await writeTeamProjects(state, created.teamId, projectIds);
    return created;
  },
  join: async (state: ShinsaState, url: string, projectIds: readonly string[]) => {
    const joined = await requestJson<{ status: TeamJoinStatus; teamId: string }>('/api/remote/teams/join', {
      url,
    });
    const shared = listTeamProjectIds(state, joined.teamId);
    await writeTeamProjects(state, joined.teamId, [...shared, ...projectIds]);
    return joined;
  },
  writeProjects: writeTeamProjects,
  readLink: (teamId: string) => requestJson<{ url: string }>('/api/remote/teams/link', { teamId }),
  removeLink: (teamId: string) => act('/link/remove', { teamId }),
  acceptRequest: (teamId: string, userId: string) => act('/requests/accept', { teamId, userId }),
  declineRequest: (teamId: string, userId: string) => act('/requests/decline', { teamId, userId }),
  removeMember: (teamId: string, userId: string) => act('/members/remove', { teamId, userId }),
  leave: (teamId: string) => act('/leave', { teamId }),
  remove: (teamId: string) => act('/remove', { teamId }),
  grantAccess: async (teamId: string, userId: string) => {
    const snapshot = await requestJson<RemoteSnapshot>('/api/remote/members/grant', { teamId, userId });
    connection.replaceRemote(snapshot);
    return snapshot;
  },
};

export type TeamActions = typeof TEAM_ACTIONS;
