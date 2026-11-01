import { DomainError } from '@shinsa/core';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import type { Remote } from './index.ts';
import type { TeamFeeds } from './team-feeds.ts';
import type { Teams } from './teams.ts';

function readText(fields: JsonObject, name: string, message: string) {
  const value = fields[name];
  if (typeof value !== 'string' || !value.trim()) throw new DomainError(`${name}_invalid`, message);
  return value;
}

function createPost(remote: Remote) {
  return (path: string, act: (fields: JsonObject) => unknown): ApiRoute => ({
    method: 'POST',
    pattern: new RegExp(`^/api/remote${path}$`),
    respond: async (_match, request) => {
      const fields = await readJsonObject(request);
      const result = await act(fields);
      return Response.json(result ?? remote.snapshot());
    },
  });
}

const TEAM_MESSAGE = 'Name the team by its id.';

const USER_MESSAGE = 'Name the person by their GitHub id.';

export function createTeamRoutes(remote: Remote, teams: Teams): ApiRoute[] {
  const post = createPost(remote);
  const team = (fields: JsonObject) => readText(fields, 'teamId', TEAM_MESSAGE);
  const user = (fields: JsonObject) => readText(fields, 'userId', USER_MESSAGE);
  return [
    post('/teams/create', async (fields) => {
      const teamId = await teams.create(readText(fields, 'name', 'Give the team a name.'));
      return { teamId, url: await teams.resolveJoinUrl(teamId) };
    }),
    post('/teams/join', (fields) => teams.join(readText(fields, 'url', 'Paste the team link.'))),
    post('/teams/link', async (fields) => ({ url: await teams.resolveJoinUrl(team(fields)) })),
    post('/teams/link/renew', async (fields) => {
      await teams.renewInvite(team(fields));
      return { url: await teams.resolveJoinUrl(team(fields)) };
    }),
    post('/teams/link/remove', async (fields) => {
      await teams.turnOffInvite(team(fields));
    }),
    post('/teams/requests/accept', async (fields) => {
      await teams.acceptRequest(team(fields), user(fields));
    }),
    post('/teams/requests/decline', async (fields) => {
      await teams.declineRequest(team(fields), user(fields));
    }),
    post('/teams/members/remove', async (fields) => {
      await teams.removeMember(team(fields), user(fields));
    }),
    post('/teams/leave', async (fields) => {
      await teams.leave(team(fields));
    }),
    post('/teams/remove', async (fields) => {
      await teams.remove(team(fields));
    }),
  ];
}

export function createTeamFeedRoutes(feeds: TeamFeeds): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/teams\/tasks$/,
      respond: (_match, request) => {
        const query = new URL(request.url).searchParams;
        const tasks = feeds.listTasks({ teamId: query.get('team'), open: query.get('open') === 'true' });
        return Promise.resolve(Response.json({ machines: feeds.snapshot().machines, tasks }));
      },
    },
  ];
}

export function createRemoteRoutes(remote: Remote): ApiRoute[] {
  const post = createPost(remote);
  return [
    {
      method: 'GET',
      pattern: /^\/api\/remote$/,
      respond: () => Promise.resolve(Response.json(remote.snapshot())),
    },
    post('/pair', async () => {
      await remote.startPairing();
    }),
    post('/pair/cancel', () => {
      remote.cancelPairing();
    }),
    post('/enable', () => {
      remote.enable();
    }),
    post('/disable', () => remote.disable()),
    post('/remove', () => remote.remove()),
    post('/link/create', () => remote.createLink()),
    post('/link/remove', () => remote.removeLink()),
    post('/requests/accept', async (fields) => {
      await remote.acceptRequest(readText(fields, 'requestId', 'Name the access request to accept.'));
    }),
    post('/requests/decline', (fields) => {
      remote.declineRequest(readText(fields, 'requestId', 'Name the access request to decline.'));
    }),
    post('/members/grant', async (fields) => {
      await remote.grantTeammate(
        readText(fields, 'userId', 'Name the teammate by their GitHub id.'),
        readText(fields, 'teamId', 'Name the team you share with them.')
      );
    }),
    post('/members/remove', async (fields) => {
      await remote.removeMember(readText(fields, 'userId', 'Name the member to remove by their GitHub id.'));
    }),
    post('/devices/remove', (fields) => {
      const publicKey = readText(fields, 'publicKey', 'Name the device to remove by its key.');
      if (!remote.removeDevice(publicKey))
        throw new DomainError('device_not_found', 'No device with that key is enrolled.');
    }),
  ];
}
