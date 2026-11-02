import { afterEach, describe, expect, test } from 'bun:test';
import { REMOTE_APP_ORIGIN, REMOTE_PATHS, resolveMachineTeamPath, SLACK_RELAY_PATHS } from '@shinsa/core';
import { BodyInvalid, MembersFull, Revoked } from '@shinsa/core/remote/errors';
import { Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { isRemoteRetryable, RemoteControl, selectRemoteFailureTag } from '../../src/remote/client/index.ts';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { RemoteClient } from '../../src/remote/client/service.ts';
import { type FakeControlPlane, refuse, startFakeControlPlane } from './control-plane.ts';

const USER = { id: 'u1', login: 'kai', name: null, avatarUrl: null };

const MEMBER = { user: USER, addedAt: 1 };

const TEAM = {
  id: 'team1',
  name: 'Growth',
  owner: USER,
  role: 'owner',
  members: [],
  requests: [],
  machines: [],
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
  return { plane: current, control: new RemoteControl({ origin: current.origin }) };
}

function answer(plane: FakeControlPlane, path: string, body: unknown) {
  plane.answers.set(path, () => Response.json(body));
}

describe('the client for app.shinsa.dev', () => {
  test('defaults to app.shinsa.dev', () => {
    expect(new RemoteControl().origin).toBe(REMOTE_APP_ORIGIN);
  });

  test('starts and polls pairing without a token', async () => {
    const { plane, control } = start();
    expect(await control.requestPairStart({ name: 'Mac', publicKey: 'p', version: '1' })).toMatchObject({
      claimCode: 'c',
    });
    expect(plane.calls.map((call) => [call.path, call.token, call.body])).toEqual([
      [REMOTE_PATHS.pairStart, null, { name: 'Mac', publicKey: 'p', version: '1' }],
    ]);
  });

  test('sends every machine call with the machine token and decodes its answer', async () => {
    const { plane, control } = start();
    answer(plane, REMOTE_PATHS.heartbeat, HEARTBEAT);
    answer(plane, REMOTE_PATHS.machineRequester, USER);
    answer(plane, REMOTE_PATHS.machineMemberAdd, MEMBER);
    answer(plane, REMOTE_PATHS.machineHandoffs, { token: 'handoff-token' });
    answer(plane, REMOTE_PATHS.machineGuestAdd, MEMBER);
    expect(await control.recordHeartbeat('m', { localUrl: 'http://127.0.0.1:7446', version: '1' })).toEqual(
      HEARTBEAT
    );
    await control.recordOffline('m');
    await control.requestRemoval('m');
    expect(await control.requestInvite('m')).toEqual({ token: 'invite-token' });
    await control.requestInviteRemoval('m');
    expect(await control.requestRequester('m', 'u1')).toEqual(USER);
    expect(await control.requestMemberAddition('m', 'u1')).toEqual(MEMBER);
    await control.requestMemberRemoval('m', 'u1');
    expect(await control.requestHandoff('m')).toEqual({ token: 'handoff-token' });
    await control.requestHandoffRemoval('m', 'handoff-token');
    expect(await control.requestGuestAddition('m', 'u1')).toEqual(MEMBER);
    await control.requestGuestRemoval('m', 'u1');
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
    const { plane, control } = start();
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
    await control.requestTeamCreation('m', 'Growth');
    await control.requestTeamJoin('m', 'i');
    expect(await control.requestTeamInvite('m', 'team1')).toEqual({ invite: 'i2' });
    await control.requestTeamInviteRemoval('m', 'team1');
    expect(await control.requestTeamMemberAddition('m', 'team1', 'u1')).toEqual(MEMBER);
    await control.requestTeamMemberRemoval('m', 'team1', 'u1');
    await control.requestTeamDecline('m', 'team1', 'u1');
    await control.requestTeamLeave('m', 'team1');
    await control.requestTeamRemoval('m', 'team1');
    expect(await control.requestTeamConnect('m', 'team1', 'k3x9')).toEqual({ url: 'wss://x', expiresAt: 1 });
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
    ]);
  });

  test('reads a refusal as its typed failure, revoked included', async () => {
    const { plane, control } = start();
    plane.answers.set(REMOTE_PATHS.heartbeat, () => refuse(Revoked, 'Removed.'));
    await expect(
      control.recordHeartbeat('m', { localUrl: 'http://127.0.0.1:7446', version: '1' })
    ).rejects.toMatchObject({
      _tag: 'Revoked',
      message: 'Removed.',
    });
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => refuse(MembersFull));
    const full = await control.requestMemberAddition('m', 'u1').catch((error: unknown) => error);
    expect(selectRemoteFailureTag(full)).toBe('MembersFull');
    expect(isRemoteRetryable(full)).toBe(false);
    expect(selectRemoteFailureTag(new Error('plain'))).toBeNull();
  });

  test('says app.shinsa.dev is unreachable for any answer the API does not declare', async () => {
    const { plane, control } = start();
    plane.answers.set(REMOTE_PATHS.machineRemove, () => new Response('busy', { status: 503 }));
    await expect(control.requestRemoval('m')).rejects.toMatchObject({
      _tag: 'RemoteUnreachable',
      status: 503,
      retryable: true,
    });
    plane.answers.set(REMOTE_PATHS.machineInvites, () => Response.json({ token: 7 }));
    await expect(control.requestInvite('m')).rejects.toMatchObject({ status: null, retryable: true });
    plane.answers.set(REMOTE_PATHS.machineInviteRemove, () => refuse(BodyInvalid));
    await expect(control.requestInviteRemoval('m')).rejects.toMatchObject({ status: 400, retryable: false });
    plane.answers.set(REMOTE_PATHS.machineRequester, () => new Response('', { status: 401 }));
    await expect(control.requestRequester('m', 'u1')).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
    const down = new RemoteControl({ origin: 'http://127.0.0.1:1' });
    const unreachable = await down.requestTeamLeave('m', 'team1').catch((error: unknown) => error);
    expect(unreachable).toMatchObject({ _tag: 'RemoteUnreachable', status: null });
    expect(isRemoteRetryable(unreachable)).toBe(true);
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
    const { plane, control } = start();
    const thread = { teamId: 'T1', channelId: 'C1', threadTs: '1.1' };
    answer(plane, SLACK_RELAY_PATHS.links, { links: [] });
    answer(plane, SLACK_RELAY_PATHS.post, { ts: '2.1' });
    answer(plane, SLACK_RELAY_PATHS.session, { applied: true });
    answer(plane, SLACK_RELAY_PATHS.react, { applied: false });
    expect(await control.requestSlackLinks('m')).toEqual({ links: [] });
    await control.requestSlackUnlink('m');
    const message = { text: 'Hi', blocks: [] };
    expect(await control.requestSlackPost('m', { ...thread, replaceTs: null, message })).toEqual({
      ts: '2.1',
    });
    expect(await control.requestSlackSession('m', { ...thread, status: 'processing' })).toEqual({
      applied: true,
    });
    expect(
      await control.requestSlackReaction('m', { ...thread, messageTs: '1.2', add: 'eyes', remove: null })
    ).toEqual({ applied: false });
    expect(plane.calls.map((call) => [call.path, call.token])).toEqual([
      [SLACK_RELAY_PATHS.links, 'm'],
      [SLACK_RELAY_PATHS.unlink, 'm'],
      [SLACK_RELAY_PATHS.post, 'm'],
      [SLACK_RELAY_PATHS.session, 'm'],
      [SLACK_RELAY_PATHS.react, 'm'],
    ]);
  });
});
