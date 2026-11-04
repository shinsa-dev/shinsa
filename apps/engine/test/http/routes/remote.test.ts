import { afterEach, describe, expect, test } from 'bun:test';
import type { PlacementQuestion } from '@shinsa/core';
import type { Remote } from '../../../src/remote/index.ts';
import type { PlacementAsker } from '../../../src/remote/placement.ts';
import type { TeamFeeds } from '../../../src/remote/team-feeds.ts';
import type { Teams } from '../../../src/remote/teams.ts';
import type { Slack } from '../../../src/slack/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

const SNAPSHOT = { enabled: true };

function createRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string, answer: unknown = undefined) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer;
    };
  return { calls, record };
}

function createRemote() {
  const { calls, record } = createRecorder();
  const remote = {
    tunnelHost: null,
    isEnabled: false,
    snapshot: () => SNAPSHOT,
    startPairing: record('startPairing', Promise.resolve()),
    cancelPairing: record('cancelPairing'),
    enable: record('enable'),
    disable: record('disable', Promise.resolve()),
    remove: record('remove', Promise.resolve()),
    createLink: record('createLink', Promise.resolve()),
    removeLink: record('removeLink', Promise.resolve()),
    acceptRequest: record('acceptRequest', Promise.resolve()),
    declineRequest: record('declineRequest'),
    grantTeammate: record('grantTeammate', Promise.resolve()),
    removeMember: record('removeMember', Promise.resolve()),
    removeDevice: (key: unknown) => {
      calls.push(['removeDevice', key]);
      return key === 'known';
    },
  };
  return { calls, remote: remote as unknown as Remote };
}

function createTeams() {
  const { calls, record } = createRecorder();
  const teams = {
    create: record('create', Promise.resolve('team-1')),
    join: record('join', Promise.resolve({ status: 'requested', teamId: 'team-2' })),
    resolveJoinUrl: (teamId: string) => Promise.resolve(`https://app.shinsa.dev/share/team#${teamId}`),
    renewInvite: record('renewInvite', Promise.resolve()),
    turnOffInvite: record('turnOffInvite', Promise.resolve()),
    acceptRequest: record('acceptRequest', Promise.resolve()),
    declineRequest: record('declineRequest', Promise.resolve()),
    removeMember: record('removeMember', Promise.resolve()),
    leave: record('leave', Promise.resolve()),
    remove: record('remove', Promise.resolve()),
    updateScopes: record('updateScopes', Promise.resolve()),
    updateExtra: record('updateExtra', undefined),
    listKeys: () => [{ teamId: 't', name: 'Core', key: 'k' }],
  };
  return { calls, teams: teams as unknown as Teams };
}

describe('remote access over HTTP', () => {
  test('every change answers the snapshot after it runs', async () => {
    const { calls, remote } = createRemote();
    const { send, post } = startRoutes({ remote });
    expect(await (await send('/api/remote')).json()).toEqual(SNAPSHOT);
    const changes: [string, unknown][] = [
      ['/api/remote/pair', {}],
      ['/api/remote/pair/cancel', {}],
      ['/api/remote/enable', {}],
      ['/api/remote/disable', {}],
      ['/api/remote/remove', {}],
      ['/api/remote/link/create', {}],
      ['/api/remote/link/remove', {}],
      ['/api/remote/requests/accept', { requestId: 'r1' }],
      ['/api/remote/requests/decline', { requestId: 'r2' }],
      ['/api/remote/members/grant', { userId: 'u1', teamId: 't1' }],
      ['/api/remote/members/remove', { userId: 'u2' }],
      ['/api/remote/devices/remove', { publicKey: 'known' }],
    ];
    for (const [path, body] of changes) expect(await (await post(path, body)).json()).toEqual(SNAPSHOT);
    expect(calls).toEqual([
      ['startPairing'],
      ['cancelPairing'],
      ['enable'],
      ['disable'],
      ['remove'],
      ['createLink'],
      ['removeLink'],
      ['acceptRequest', 'r1'],
      ['declineRequest', 'r2'],
      ['grantTeammate', 'u1', 't1'],
      ['removeMember', 'u2'],
      ['removeDevice', 'known'],
    ]);
  });

  test('a missing or blank field names what to send, and an unknown device is refused', async () => {
    const { calls, remote } = createRemote();
    const { post } = startRoutes({ remote });
    expect(await readFailure(await post('/api/remote/requests/accept', { requestId: ' ' }))).toEqual({
      status: 400,
      code: 'requestId_invalid',
      message: 'Name the access request to accept.',
    });
    expect(await readFailure(await post('/api/remote/requests/decline', {}))).toMatchObject({
      message: 'Name the access request to decline.',
    });
    expect(await readFailure(await post('/api/remote/members/grant', { teamId: 't1' }))).toMatchObject({
      code: 'userId_invalid',
      message: 'Name the teammate by their GitHub id.',
    });
    expect(await readFailure(await post('/api/remote/members/grant', { userId: 'u1' }))).toMatchObject({
      code: 'teamId_invalid',
      message: 'Name the team you share with them.',
    });
    expect(await readFailure(await post('/api/remote/members/remove', { userId: 7 }))).toMatchObject({
      message: 'Name the member to remove by their GitHub id.',
    });
    expect(await readFailure(await post('/api/remote/devices/remove', {}))).toMatchObject({
      code: 'publicKey_invalid',
    });
    expect(await readFailure(await post('/api/remote/devices/remove', { publicKey: 'other' }))).toEqual({
      status: 400,
      code: 'device_not_found',
      message: 'No device with that key is enrolled.',
    });
    expect(calls).toEqual([['removeDevice', 'other']]);
  });

  test('a failing change answers its error, and without remote access the routes are not found', async () => {
    const { remote } = createRemote();
    (remote as unknown as { disable: () => Promise<void> }).disable = () =>
      Promise.reject(new Error('Pair this machine first.'));
    expect(await readFailure(await startRoutes({ remote }).post('/api/remote/disable', {}))).toMatchObject({
      code: 'request_failed',
      message: 'Pair this machine first.',
    });
    const bare = startRoutes();
    expect((await bare.send('/api/remote')).status).toBe(404);
    expect((await bare.post('/api/remote/enable', {})).status).toBe(404);
    expect((await bare.post('/api/remote/devices/remove', { publicKey: 'k' })).status).toBe(404);
  });
});

describe('teams over HTTP', () => {
  test('creating a team and its links answer the team link; every other change the snapshot', async () => {
    const { remote } = createRemote();
    const { calls, teams } = createTeams();
    const { post, send } = startRoutes({ remote, teams });
    expect(await (await post('/api/remote/teams/create', { name: 'Core' })).json()).toEqual({
      teamId: 'team-1',
      url: 'https://app.shinsa.dev/share/team#team-1',
    });
    expect(await (await post('/api/remote/teams/join', { url: 'https://x' })).json()).toEqual({
      status: 'requested',
      teamId: 'team-2',
    });
    expect(await (await post('/api/remote/teams/link', { teamId: 't' })).json()).toEqual({
      url: 'https://app.shinsa.dev/share/team#t',
    });
    expect(await (await post('/api/remote/teams/link/renew', { teamId: 't' })).json()).toEqual({
      url: 'https://app.shinsa.dev/share/team#t',
    });
    for (const path of ['link/remove', 'leave', 'remove'])
      expect(await (await post(`/api/remote/teams/${path}`, { teamId: 't' })).json()).toEqual(SNAPSHOT);
    for (const path of ['requests/accept', 'requests/decline', 'members/remove'])
      expect(await (await post(`/api/remote/teams/${path}`, { teamId: 't', userId: 'u' })).json()).toEqual(
        SNAPSHOT
      );
    const narrow = { teamId: 't', scopes: ['share'] };
    expect(await (await post('/api/remote/teams/scopes', narrow)).json()).toEqual(SNAPSHOT);
    await post('/api/remote/teams/scopes', { ...narrow, userId: 'u', scopes: null });
    const extra = { teamId: 't', userId: 'u', scopes: ['message'] };
    expect(await (await post('/api/remote/teams/extra', extra)).json()).toEqual(SNAPSHOT);
    expect(await (await send('/api/remote/teams/keys')).json()).toEqual({
      keys: [{ teamId: 't', name: 'Core', key: 'k' }],
    });
    expect(calls).toEqual([
      ['create', 'Core'],
      ['join', 'https://x'],
      ['renewInvite', 't'],
      ['turnOffInvite', 't'],
      ['leave', 't'],
      ['remove', 't'],
      ['acceptRequest', 't', 'u'],
      ['declineRequest', 't', 'u'],
      ['removeMember', 't', 'u'],
      ['updateScopes', 't', null, ['share']],
      ['updateScopes', 't', 'u', null],
      ['updateExtra', 't', 'u', ['message']],
    ]);
  });

  test('a team or person left out is named, and teams need remote access', async () => {
    const { remote } = createRemote();
    const { teams } = createTeams();
    const { post } = startRoutes({ remote, teams });
    expect(await readFailure(await post('/api/remote/teams/create', { name: '' }))).toEqual({
      status: 400,
      code: 'name_invalid',
      message: 'Give the team a name.',
    });
    expect(await readFailure(await post('/api/remote/teams/join', {}))).toMatchObject({
      code: 'url_invalid',
      message: 'Paste the team link.',
    });
    expect(await readFailure(await post('/api/remote/teams/leave', {}))).toEqual({
      status: 400,
      code: 'teamId_invalid',
      message: 'Name the team by its id.',
    });
    expect(await readFailure(await post('/api/remote/teams/members/remove', { teamId: 't' }))).toEqual({
      status: 400,
      code: 'userId_invalid',
      message: 'Name the person by their GitHub id.',
    });
    const alone = startRoutes({ teams });
    expect((await alone.post('/api/remote/teams/create', { name: 'Core' })).status).toBe(404);
  });

  test('the team feed lists teammates’ tasks, open ones on request', async () => {
    const asked: unknown[] = [];
    const teamFeeds = {
      snapshot: () => ({ machines: [{ id: 'm1' }], tasks: [] }),
      listTasks: (filter: unknown) => {
        asked.push(filter);
        return [{ task: { id: 'task-1' } }];
      },
    } as unknown as TeamFeeds;
    const { send } = startRoutes({ teamFeeds });
    expect(await (await send('/api/teams/tasks')).json()).toEqual({
      machines: [{ id: 'm1' }],
      tasks: [{ task: { id: 'task-1' } }],
    });
    await send('/api/teams/tasks?team=team1&open=true');
    expect(asked).toEqual([
      { teamId: null, open: false },
      { teamId: 'team1', open: true },
    ]);
    expect((await startRoutes().send('/api/teams/tasks')).status).toBe(404);
  });
});

describe('placement over HTTP', () => {
  const QUESTION: PlacementQuestion = {
    request: 'Run the Xcode simulator tests',
    machines: [
      {
        id: 'studio',
        name: 'Studio',
        policies: ['Run Xcode simulator tests on this machine.'],
        projects: [],
        repositories: [],
        open: 1,
        capacity: null,
        resources: null,
      },
      {
        id: 'box',
        name: 'Build box',
        policies: [],
        projects: [],
        repositories: [],
        open: 0,
        capacity: 4,
        resources: null,
      },
    ],
  };

  test('answers with the machine, and refuses a question it cannot read', async () => {
    const asked: PlacementQuestion[] = [];
    const place: PlacementAsker = (question) => {
      asked.push(question);
      return Promise.resolve({ machineId: 'box', reason: 'Room.' });
    };
    const { post } = startRoutes({ place });
    const answered = await post('/api/placement', QUESTION);
    expect(await answered.json()).toEqual({ answer: { machineId: 'box', reason: 'Room.' } });
    expect(await readFailure(await post('/api/placement', { request: 'x', machines: [] }))).toEqual({
      status: 400,
      code: 'placement_invalid',
      message: 'Send the request and two or more machines with their policies, projects and load.',
    });
    expect(asked).toHaveLength(1);
    expect((await startRoutes().post('/api/placement', QUESTION)).status).toBe(404);
  });
});

describe('Slack over HTTP', () => {
  test('reads the links and disconnects, and is not found without Slack', async () => {
    const calls: string[] = [];
    const slack = {
      snapshot: () => {
        calls.push('snapshot');
        return Promise.resolve({ remote: true, links: [] });
      },
      disconnect: () => {
        calls.push('disconnect');
        return Promise.resolve({ remote: true, links: [] });
      },
    } as unknown as Slack;
    const { send, post } = startRoutes({ slack });
    expect(await (await send('/api/slack')).json()).toEqual({ remote: true, links: [] });
    expect((await post('/api/slack/disconnect', {})).status).toBe(200);
    expect(calls).toEqual(['snapshot', 'disconnect']);
    expect((await startRoutes().send('/api/slack')).status).toBe(404);
    expect((await startRoutes().post('/api/slack/disconnect', {})).status).toBe(404);
  });
});
