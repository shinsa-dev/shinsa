import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_TEAM_SCOPES,
  type InstanceId,
  REMOTE_APP_ORIGIN,
  type RemoteUserId,
  type TeamId,
  REMOTE_PATHS,
  resolveMachineTeamPath,
  SLACK_RELAY_PATHS,
} from '@shinsa/core';
import { BodyInvalid, MembersFull, Revoked } from '@shinsa/core/remote/errors';
import { Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { RemoteOrigin } from '../../../src/remote/client/schema.ts';
import { RemoteClient } from '../../../src/remote/client/service.ts';
import { type FakeControlPlane, refuse, startFakeControlPlane } from '../control-plane.ts';

const USER_ID = 'u1' as RemoteUserId;

const TEAM_ID = 'team1' as TeamId;

const INSTANCE_ID = 'k3x9' as InstanceId;

const USER = { id: 'u1', login: 'kai', name: null, avatarUrl: null };

const MEMBER = { user: USER, addedAt: 1 };

const TEAM = {
  id: 'team1',
  name: 'Growth',
  owner: USER,
  role: 'owner' as const,
  members: [],
  requests: [],
  machines: [],
  scopes: DEFAULT_TEAM_SCOPES,
  overrides: [],
  createdAt: 1,
};

const HEARTBEAT = { ok: true as const, owner: USER, members: [], guests: [], teams: [] };

let current: FakeControlPlane | null = null;

afterEach(async () => {
  await current?.stop();
  current = null;
});

function start() {
  current = startFakeControlPlane();
  return { plane: current };
}

function callClient<A, E>(
  plane: { origin: string },
  call: (client: RemoteClient['Service']) => Effect.Effect<A, E>
) {
  return Effect.runPromise(
    RemoteClient.use(call).pipe(
      Effect.provide(
        RemoteClient.layer.pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Layer.succeed(RemoteOrigin, plane.origin))
        )
      )
    )
  );
}

const BEAT = { localUrl: 'http://127.0.0.1:7446', version: '1' };

function answer(plane: FakeControlPlane, path: string, body: unknown) {
  plane.answers.set(path, () => Response.json(body));
}

describe('the client for app.shinsa.dev', () => {
  test('defaults to app.shinsa.dev', () => {
    expect(
      Effect.runSync(
        Effect.gen(function* () {
          return yield* RemoteOrigin;
        })
      )
    ).toBe(REMOTE_APP_ORIGIN);
  });

  test('starts and polls pairing without a token', async () => {
    const { plane } = start();
    expect(
      await callClient(plane, (client) => client.pairing.start({ name: 'Mac', publicKey: 'p', version: '1' }))
    ).toMatchObject({
      claimCode: 'c',
    });
    expect(plane.calls.map((call) => [call.path, call.token, call.body])).toEqual([
      [REMOTE_PATHS.pairStart, null, { name: 'Mac', publicKey: 'p', version: '1' }],
    ]);
  });

  test('sends every machine call with the machine token and decodes its answer', async () => {
    const { plane } = start();
    answer(plane, REMOTE_PATHS.heartbeat, HEARTBEAT);
    answer(plane, REMOTE_PATHS.machineRequester, USER);
    answer(plane, REMOTE_PATHS.machineMemberAdd, MEMBER);
    answer(plane, REMOTE_PATHS.machineHandoffs, { token: 'handoff-token' });
    answer(plane, REMOTE_PATHS.machineGuestAdd, MEMBER);
    expect(await callClient(plane, (client) => client.machine.heartbeat(Redacted.make('m'), BEAT))).toEqual(
      HEARTBEAT
    );
    await callClient(plane, (client) => client.machine.offline(Redacted.make('m')));
    await callClient(plane, (client) => client.machine.remove(Redacted.make('m')));
    expect(await callClient(plane, (client) => client.machine.createInvite(Redacted.make('m')))).toEqual({
      token: 'invite-token',
    });
    await callClient(plane, (client) => client.machine.removeInvite(Redacted.make('m')));
    expect(
      await callClient(plane, (client) => client.machine.findRequester(Redacted.make('m'), USER_ID))
    ).toEqual(USER);
    expect(
      await callClient(plane, (client) => client.machine.addMember(Redacted.make('m'), USER_ID))
    ).toEqual(MEMBER);
    await callClient(plane, (client) => client.machine.removeMember(Redacted.make('m'), USER_ID));
    expect(await callClient(plane, (client) => client.machine.createHandoff(Redacted.make('m')))).toEqual({
      token: 'handoff-token',
    });
    await callClient(plane, (client) => client.machine.removeHandoff(Redacted.make('m'), 'handoff-token'));
    expect(await callClient(plane, (client) => client.machine.addGuest(Redacted.make('m'), USER_ID))).toEqual(
      MEMBER
    );
    await callClient(plane, (client) => client.machine.removeGuest(Redacted.make('m'), USER_ID));
    expect(plane.calls.every((call) => call.token === 'm')).toBe(true);
    expect(plane.calls.map((call) => [call.path, call.body])).toEqual([
      [REMOTE_PATHS.heartbeat, { localUrl: 'http://127.0.0.1:7446', version: '1' }],
      [REMOTE_PATHS.offline, null],
      [REMOTE_PATHS.machineRemove, null],
      [REMOTE_PATHS.machineInvites, null],
      [REMOTE_PATHS.machineInviteRemove, null],
      [REMOTE_PATHS.machineRequester, { userId: 'u1' }],
      [REMOTE_PATHS.machineMemberAdd, { userId: 'u1' }],
      [REMOTE_PATHS.machineMemberRemove, { userId: 'u1' }],
      [REMOTE_PATHS.machineHandoffs, null],
      [REMOTE_PATHS.machineHandoffRemove, { token: 'handoff-token' }],
      [REMOTE_PATHS.machineGuestAdd, { userId: 'u1' }],
      [REMOTE_PATHS.machineGuestRemove, { userId: 'u1' }],
    ]);
  });

  test('sends every team call to its team’s path', async () => {
    const { plane } = start();
    answer(plane, REMOTE_PATHS.machineTeams, { team: TEAM, invite: 'i' });
    answer(plane, REMOTE_PATHS.machineTeamJoin, {
      status: 'member',
      teamId: 'team1',
      name: 'Growth',
      owner: USER,
    });
    answer(plane, resolveMachineTeamPath('team1', 'invite'), { invite: 'i2' });
    answer(plane, resolveMachineTeamPath('team1', 'members/add'), MEMBER);
    answer(plane, resolveMachineTeamPath('team1', 'connect'), { url: 'wss://x', expiresAt: 1 });
    answer(plane, resolveMachineTeamPath('team1', 'scopes'), TEAM);
    await callClient(plane, (client) => client.teams.create(Redacted.make('m'), 'Growth'));
    await callClient(plane, (client) => client.teams.join(Redacted.make('m'), 'i'));
    expect(await callClient(plane, (client) => client.teams.invite(Redacted.make('m'), TEAM_ID))).toEqual({
      invite: 'i2',
    });
    await callClient(plane, (client) => client.teams.removeInvite(Redacted.make('m'), TEAM_ID));
    expect(
      await callClient(plane, (client) => client.teams.addMember(Redacted.make('m'), TEAM_ID, USER_ID))
    ).toEqual(MEMBER);
    await callClient(plane, (client) => client.teams.removeMember(Redacted.make('m'), TEAM_ID, USER_ID));
    await callClient(plane, (client) => client.teams.declineRequest(Redacted.make('m'), TEAM_ID, USER_ID));
    await callClient(plane, (client) => client.teams.leave(Redacted.make('m'), TEAM_ID));
    await callClient(plane, (client) => client.teams.remove(Redacted.make('m'), TEAM_ID));
    expect(
      await callClient(plane, (client) => client.teams.connect(Redacted.make('m'), TEAM_ID, INSTANCE_ID))
    ).toEqual({ url: 'wss://x', expiresAt: 1 });
    expect(
      await callClient(plane, (client) =>
        client.teams.scopes(Redacted.make('m'), TEAM_ID, { scopes: ['message'] })
      )
    ).toEqual(TEAM);
    expect(plane.calls.map((call) => [call.path, call.body])).toEqual([
      [REMOTE_PATHS.machineTeams, { name: 'Growth' }],
      [REMOTE_PATHS.machineTeamJoin, { invite: 'i' }],
      [resolveMachineTeamPath('team1', 'invite'), null],
      [resolveMachineTeamPath('team1', 'invite/remove'), null],
      [resolveMachineTeamPath('team1', 'members/add'), { userId: 'u1' }],
      [resolveMachineTeamPath('team1', 'members/remove'), { userId: 'u1' }],
      [resolveMachineTeamPath('team1', 'requests/decline'), { userId: 'u1' }],
      [resolveMachineTeamPath('team1', 'leave'), null],
      [resolveMachineTeamPath('team1', 'remove'), null],
      [resolveMachineTeamPath('team1', 'connect'), { instanceId: 'k3x9' }],
      [resolveMachineTeamPath('team1', 'scopes'), { scopes: ['message'] }],
    ]);
  });

  test('reads a refusal as its typed failure, revoked included', async () => {
    const { plane } = start();
    plane.answers.set(REMOTE_PATHS.heartbeat, () => refuse(Revoked, 'Removed.'));
    await expect(
      callClient(plane, (client) => client.machine.heartbeat(Redacted.make('m'), BEAT))
    ).rejects.toMatchObject({
      _tag: 'Revoked',
      message: 'Removed.',
    });
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => refuse(MembersFull));
    await expect(
      callClient(plane, (client) => client.machine.addMember(Redacted.make('m'), USER_ID))
    ).rejects.toMatchObject({ _tag: 'MembersFull' });
  });

  test('says app.shinsa.dev is unreachable for any answer the API does not declare', async () => {
    const { plane } = start();
    plane.answers.set(REMOTE_PATHS.machineRemove, () => new Response('busy', { status: 503 }));
    await expect(
      callClient(plane, (client) => client.machine.remove(Redacted.make('m')))
    ).rejects.toMatchObject({
      _tag: 'RemoteUnreachable',
      status: 503,
      retryable: true,
    });
    plane.answers.set(REMOTE_PATHS.machineInvites, () => Response.json({ token: 7 }));
    await expect(
      callClient(plane, (client) => client.machine.createInvite(Redacted.make('m')))
    ).rejects.toMatchObject({ status: null, retryable: true });
    plane.answers.set(REMOTE_PATHS.machineInviteRemove, () => refuse(BodyInvalid));
    await expect(
      callClient(plane, (client) => client.machine.removeInvite(Redacted.make('m')))
    ).rejects.toMatchObject({ status: 400, retryable: false });
    plane.answers.set(REMOTE_PATHS.machineRequester, () => new Response('', { status: 401 }));
    await expect(
      callClient(plane, (client) => client.machine.findRequester(Redacted.make('m'), USER_ID))
    ).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
    const down = { origin: 'http://127.0.0.1:1' };
    const unreachable = await callClient(down, (client) =>
      client.teams.leave(Redacted.make('m'), TEAM_ID)
    ).catch((error: unknown) => error);
    expect(unreachable).toMatchObject({ _tag: 'RemoteUnreachable', status: null, retryable: true });
  });

  test('gives up on a call app.shinsa.dev does not answer in time', async () => {
    const { plane } = start();
    plane.answers.set(REMOTE_PATHS.offline, () => new Promise<Response>(() => undefined));
    const layer = RemoteClient.layer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(RemoteOrigin, plane.origin))
    );
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RemoteClient;
        const fiber = yield* Effect.forkChild(Effect.flip(client.machine.offline(Redacted.make('m'))));
        yield* TestClock.adjust('2 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())))
    );
    expect(error).toMatchObject({ _tag: 'RemoteUnreachable', endpoint: 'machine.offline', retryable: true });
  });

  test('reaches the Slack relay with the machine token', async () => {
    const { plane } = start();
    const thread = { teamId: 'T1', channelId: 'C1', threadTs: '1.1' };
    answer(plane, SLACK_RELAY_PATHS.links, { links: [] });
    answer(plane, SLACK_RELAY_PATHS.post, { ts: '2.1' });
    answer(plane, SLACK_RELAY_PATHS.session, { applied: true });
    answer(plane, SLACK_RELAY_PATHS.react, { applied: false });
    expect(await callClient(plane, (client) => client.slack.links(Redacted.make('m')))).toEqual({
      links: [],
    });
    await callClient(plane, (client) => client.slack.unlink(Redacted.make('m')));
    const message = { text: 'Hi', blocks: [] };
    expect(
      await callClient(plane, (client) =>
        client.slack.post(Redacted.make('m'), { ...thread, replaceTs: null, message })
      )
    ).toEqual({
      ts: '2.1',
    });
    expect(
      await callClient(plane, (client) =>
        client.slack.session(Redacted.make('m'), { ...thread, status: 'processing' })
      )
    ).toEqual({
      applied: true,
    });
    expect(
      await callClient(plane, (client) =>
        client.slack.react(Redacted.make('m'), { ...thread, messageTs: '1.2', add: 'eyes', remove: null })
      )
    ).toEqual({ applied: false });
    expect(plane.calls.map((call) => [call.path, call.token])).toEqual([
      [SLACK_RELAY_PATHS.links, 'm'],
      [SLACK_RELAY_PATHS.unlink, 'm'],
      [SLACK_RELAY_PATHS.post, 'm'],
      [SLACK_RELAY_PATHS.session, 'm'],
      [SLACK_RELAY_PATHS.react, 'm'],
    ]);
  });

  test('a Slack post leaves with only the fields its schema names', async () => {
    const { plane } = start();
    answer(plane, SLACK_RELAY_PATHS.post, { ts: '2.1' });
    const post = {
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.1',
      replaceTs: null,
      message: { text: 'Hi', blocks: [], worktree: '/wt/task-1' },
      machineToken: 'm',
    };
    await callClient(plane, (client) => client.slack.post(Redacted.make('m'), post as never));
    expect(plane.calls.map((call) => call.body)).toEqual([
      {
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '1.1',
        replaceTs: null,
        message: { text: 'Hi', blocks: [] },
      },
    ]);
  });
});
