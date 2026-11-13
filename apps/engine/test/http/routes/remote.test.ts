import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError, type PlacementQuestion } from '@shinsa/core';
import { Effect } from 'effect';
import type { Remote } from '../../../src/remote/machine/service.ts';
import type { PlacementAsker } from '../../../src/remote/placement/service.ts';
import type { TeamFeeds } from '../../../src/remote/team-feeds/service.ts';
import type { Teams } from '../../../src/remote/teams/service.ts';
import type { Slack } from '../../../src/slack/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

const SNAPSHOT = { enabled: true };

function createRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const step = (name: string) =>
    Effect.sync(() => {
      calls.push([name]);
    });
  const record =
    (name: string, answer: unknown = undefined) =>
    (...args: unknown[]) =>
      Effect.sync(() => {
        calls.push([name, ...args]);
        return answer;
      });
  return { calls, step, record };
}

function createRemote() {
  const { calls, step, record } = createRecorder();
  const remote = {
    isEnabled: Effect.succeed(false),
    snapshot: Effect.succeed(SNAPSHOT),
    startPairing: step('startPairing'),
    cancelPairing: step('cancelPairing'),
    enable: step('enable'),
    disable: step('disable'),
    remove: step('remove'),
    createLink: step('createLink'),
    removeLink: step('removeLink'),
    acceptRequest: record('acceptRequest'),
    declineRequest: record('declineRequest'),
    grantTeammate: record('grantTeammate'),
    shareWithTeam: record('shareWithTeam'),
    unshareTeam: record('unshareTeam'),
    removeMember: record('removeMember'),
    removeDevice: (key: string) =>
      Effect.sync(() => {
        calls.push(['removeDevice', key]);
        return key === 'known';
      }),
  };
  return { calls, remote: remote as unknown as Remote['Service'] };
}

function createTeams() {
  const { calls, record } = createRecorder();
  const teams = {
    create: record('create', 'team-1'),
    join: record('join', { status: 'requested', teamId: 'team-2' }),
    resolveJoinUrl: (teamId: string) => Effect.succeed(`https://app.shinsa.dev/share/team#${teamId}`),
    renewInvite: record('renewInvite'),
    turnOffInvite: record('turnOffInvite'),
    acceptRequest: record('acceptRequest'),
    declineRequest: record('declineRequest'),
    removeMember: record('removeMember'),
    leave: record('leave'),
    remove: record('remove'),
    updateScopes: record('updateScopes'),
    updateExtra: record('updateExtra'),
    requestKey: record('requestKey'),
    listKeys: Effect.succeed([{ teamId: 't', name: 'Core', key: 'k' }]),
  };
  return { calls, teams: teams as unknown as Teams['Service'] };
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

  test('sharing with a team gives it the machine first, and stopping takes it back after the setting', async () => {
    const { calls, remote } = createRemote();
    const routes = startRoutes({ remote });
    const sharedTeams = async () => routes.context.engine.state.settings.sharedTeams;
    expect(
      await (await routes.post('/api/remote/teams/share', { teamId: 't1', shared: true })).json()
    ).toEqual(SNAPSHOT);
    expect(await sharedTeams()).toEqual(['t1']);
    await routes.post('/api/remote/teams/share', { teamId: 't2', shared: true });
    await routes.post('/api/remote/teams/share', { teamId: 't1', shared: false });
    expect(await sharedTeams()).toEqual(['t2']);
    expect(calls).toEqual([
      ['shareWithTeam', 't1'],
      ['shareWithTeam', 't2'],
      ['unshareTeam', 't1'],
    ]);
    expect(await readFailure(await routes.post('/api/remote/teams/share', { teamId: 't1' }))).toMatchObject({
      code: 'shared_invalid',
    });
    expect(await readFailure(await routes.post('/api/remote/teams/share', { shared: true }))).toMatchObject({
      code: 'teamId_invalid',
    });
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
    const failing = {
      ...remote,
      disable: Effect.fail(new DomainError({ code: 'not_paired', message: 'Pair this machine first.' })),
    } as Remote['Service'];
    expect(
      await readFailure(await startRoutes({ remote: failing }).post('/api/remote/disable', {}))
    ).toMatchObject({
      status: 400,
      code: 'not_paired',
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
    expect(await (await post('/api/remote/teams/key/request', { teamId: 't' })).json()).toEqual(SNAPSHOT);
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
      ['requestKey', 't'],
    ]);
  });

  test('the team’s owner answers a machine that asks for the team’s key', async () => {
    const { remote } = createRemote();
    const { teams } = createTeams();
    const answered: unknown[] = [];
    const teamFeeds = {
      answerKeyRequest: (...answer: unknown[]) =>
        Effect.sync(() => {
          answered.push(answer);
          return true;
        }),
    } as unknown as TeamFeeds['Service'];
    const body = { teamId: 't', instanceId: 'm1', approve: true };
    const { post } = startRoutes({ remote, teams, teamFeeds });
    expect(await (await post('/api/remote/teams/key/answer', body)).json()).toEqual(SNAPSHOT);
    expect(answered).toEqual([['t', 'm1', true]]);
    expect((await startRoutes({ remote, teams }).post('/api/remote/teams/key/answer', body)).status).toBe(
      404
    );
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
      snapshot: Effect.succeed({ machines: [{ id: 'm1' }], tasks: [] }),
      listTasks: (filter: unknown) =>
        Effect.sync(() => {
          asked.push(filter);
          return [{ task: { id: 'task-1' } }];
        }),
    } as unknown as TeamFeeds['Service'];
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
    const place: PlacementAsker['Service'] = {
      place: (question) =>
        Effect.sync(() => {
          asked.push(question);
          return { machineId: 'box', reason: 'Room.' };
        }),
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
  const CHANNEL = { teamId: 'T1', teamName: 'Acme', channelId: 'C1', channelName: 'alerts', private: false };

  test('reads the links and disconnects, and is not found without Slack', async () => {
    const calls: string[] = [];
    const slack = {
      snapshot: (viewer: string | null) =>
        Effect.sync(() => {
          calls.push(`snapshot ${viewer}`);
          return { remote: true, links: [] };
        }),
      disconnect: Effect.sync(() => {
        calls.push('disconnect');
        return { remote: true, links: [] };
      }),
      channels: Effect.succeed([CHANNEL]),
    } as unknown as Slack['Service'];
    const { send, post } = startRoutes({ slack });
    expect(await (await send('/api/slack/channels')).json()).toEqual({ channels: [CHANNEL] });
    expect((await startRoutes().send('/api/slack/channels')).status).toBe(404);
    const refusing = {
      channels: Effect.fail(new DomainError({ code: 'slack_not_connected', message: 'Connect Slack.' })),
    } as unknown as Slack['Service'];
    expect(await (await startRoutes({ slack: refusing }).send('/api/slack/channels')).json()).toEqual({
      error: { code: 'slack_not_connected', message: 'Connect Slack.' },
    });
    expect(await (await send('/api/slack')).json()).toEqual({ remote: true, links: [] });
    expect((await post('/api/slack/disconnect', {})).status).toBe(200);
    expect(calls).toEqual(['snapshot null', 'disconnect']);
    expect((await startRoutes().send('/api/slack')).status).toBe(404);
    expect((await startRoutes().post('/api/slack/disconnect', {})).status).toBe(404);
  });

  test('lists the channels and people of one workspace for Autopilot', async () => {
    const asked: string[] = [];
    const slack = {
      directory: (teamId: string) =>
        Effect.sync(() => {
          asked.push(teamId);
          return { teamId, channels: [], people: [], problem: null };
        }),
    } as unknown as Slack['Service'];
    const { send } = startRoutes({ slack });
    expect(await (await send('/api/slack/directory?teamId=T1')).json()).toEqual({
      teamId: 'T1',
      channels: [],
      people: [],
      problem: null,
    });
    expect(asked).toEqual(['T1']);
    expect((await send('/api/slack/directory')).status).toBe(400);
    expect((await startRoutes().send('/api/slack/directory?teamId=T1')).status).toBe(404);
  });

  test('sends a test escalation to one Slack contact, and refuses a contact it cannot read', async () => {
    const tested: unknown[] = [];
    const slack = {
      testContact: (contact: unknown) =>
        Effect.sync(() => {
          tested.push(contact);
          return { sent: true, problem: null };
        }),
    } as unknown as Slack['Service'];
    const contact = { kind: 'slack_channel', teamId: 'T1', id: 'C1', name: 'oncall' };
    const { post } = startRoutes({ slack });
    expect(await (await post('/api/slack/test', { contact })).json()).toEqual({ sent: true, problem: null });
    expect(tested).toEqual([contact]);
    expect((await post('/api/slack/test', { contact: { kind: 'team' } })).status).toBe(400);
    expect((await startRoutes().post('/api/slack/test', { contact })).status).toBe(404);
  });

  test('reads a member’s own links, and the owner’s from the owner or the keyboard', async () => {
    const viewers: (string | null)[] = [];
    const slack = {
      snapshot: (viewer: string | null) =>
        Effect.sync(() => {
          viewers.push(viewer);
          return { remote: true, links: [] };
        }),
    } as unknown as Slack['Service'];
    const remote = {
      ...createRemote().remote,
      isOwner: (userId: string | null) => Effect.succeed(userId === 'u-owner'),
    };
    const { send } = startRoutes({ slack, remote });
    await send('/api/slack');
    await send('/api/slack', {}, { via: 'channel', guest: null, userId: 'u-owner' });
    await send('/api/slack', {}, { via: 'channel', guest: null, userId: 'u-kai' });
    await startRoutes({ slack }).send('/api/slack', {}, { via: 'channel', guest: null, userId: 'u-kai' });
    expect(viewers).toEqual([null, null, 'u-kai', null]);
  });
});
