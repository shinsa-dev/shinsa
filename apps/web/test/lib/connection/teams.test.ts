import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import * as socket from '@/lib/connection/socket.ts';
import { TEAM_ACTIONS } from '@/lib/connection/teams.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { createTeamEntry, TEAM_URL } from '../../support/teams.ts';

let answers: Record<string, unknown> = {};
let sent: { path: string; body: unknown }[] = [];
let fetchSpy: Mock<typeof fetch>;
let commandSpy: Mock<typeof socket.sendCommand>;
let replaced: Mock<typeof socket.connection.replaceRemote>;

const STATE = createShinsaState({
  projects: [createProject({ id: 'web', teamIds: ['team1'] }), createProject({ id: 'api' })],
});

beforeEach(() => {
  answers = {};
  sent = [];
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const path = String(input);
    sent.push({ path, body: JSON.parse(String(init?.body)) });
    return Response.json(answers[path] ?? createRemoteSnapshot());
  }) as typeof fetch);
  commandSpy = spyOn(socket, 'sendCommand').mockResolvedValue(undefined as never);
  replaced = spyOn(socket.connection, 'replaceRemote').mockReturnValue(undefined);
});

afterEach(() => {
  fetchSpy.mockRestore();
  commandSpy.mockRestore();
  replaced.mockRestore();
});

describe('team actions on this machine', () => {
  it('makes a team, then shares the projects you chose with it', async () => {
    answers['/api/remote/teams/create'] = { teamId: 'team9', url: TEAM_URL };
    expect(await TEAM_ACTIONS.create(STATE, 'Platform', ['api'])).toEqual({ teamId: 'team9', url: TEAM_URL });
    expect(sent[0]).toEqual({ path: '/api/remote/teams/create', body: { name: 'Platform' } });
    expect(commandSpy.mock.calls.map(([command]) => command)).toEqual([
      { type: 'project.add_to_team', projectId: 'api', teamId: 'team9' },
    ]);
  });

  it('asks to join with a link, then adds the projects you chose, keeping those it already sees', async () => {
    answers['/api/remote/teams/join'] = { status: 'requested', teamId: 'team1' };
    expect(await TEAM_ACTIONS.join(STATE, TEAM_URL, ['api'])).toEqual({
      status: 'requested',
      teamId: 'team1',
    });
    expect(sent[0]?.body).toEqual({ url: TEAM_URL });
    expect(commandSpy.mock.calls.map(([command]) => command)).toEqual([
      { type: 'project.add_to_team', projectId: 'api', teamId: 'team1' },
    ]);
  });

  it('reads the link, and sends each change to its route, keeping the snapshot', async () => {
    answers['/api/remote/teams/link'] = { url: TEAM_URL };
    expect(await TEAM_ACTIONS.readLink('team1')).toEqual({ url: TEAM_URL });
    const snapshot = createRemoteSnapshot({ teams: [createTeamEntry()] });
    for (const path of [
      '/link/remove',
      '/requests/accept',
      '/requests/decline',
      '/members/remove',
      '/leave',
      '/remove',
    ])
      answers[`/api/remote/teams${path}`] = snapshot;
    answers['/api/remote/members/grant'] = snapshot;
    await TEAM_ACTIONS.removeLink('team1');
    await TEAM_ACTIONS.acceptRequest('team1', '9');
    await TEAM_ACTIONS.declineRequest('team1', '9');
    await TEAM_ACTIONS.removeMember('team1', '7');
    await TEAM_ACTIONS.leave('team1');
    expect(await TEAM_ACTIONS.remove('team1')).toEqual(snapshot);
    expect(await TEAM_ACTIONS.grantAccess('team1', '7')).toEqual(snapshot);
    expect(sent.slice(1).map((entry) => [entry.path, entry.body])).toEqual([
      ['/api/remote/teams/link/remove', { teamId: 'team1' }],
      ['/api/remote/teams/requests/accept', { teamId: 'team1', userId: '9' }],
      ['/api/remote/teams/requests/decline', { teamId: 'team1', userId: '9' }],
      ['/api/remote/teams/members/remove', { teamId: 'team1', userId: '7' }],
      ['/api/remote/teams/leave', { teamId: 'team1' }],
      ['/api/remote/teams/remove', { teamId: 'team1' }],
      ['/api/remote/members/grant', { teamId: 'team1', userId: '7' }],
    ]);
    expect(replaced).toHaveBeenCalledTimes(7);
    expect(replaced).toHaveBeenLastCalledWith(snapshot);
  });
});
