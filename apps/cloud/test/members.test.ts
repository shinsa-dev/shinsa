import { describe, expect, test } from 'bun:test';
import {
  type HeartbeatResponse,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  MAX_INSTANCE_MEMBERS,
  type MachineCredentials,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteMember,
  type RemoteUser,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstanceRemovePath,
  SLACK_RELAY_PATHS,
  verifyConnectToken,
} from '@shinsa/core';
import { MAX_INSTANCES_PER_USER } from '../src/pairing.ts';
import { createHarness, type Harness, heartbeat, pairMachine, readJson } from './harness.ts';

const MONA: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI: RemoteUser = { id: '2', login: 'kai', name: null, avatarUrl: null };

function machineAuth(credentials: MachineCredentials) {
  return { bearer: credentials.machineToken, sameOrigin: false };
}

async function createInvite(harness: Harness, credentials: MachineCredentials) {
  return readJson<InviteCreateResponse>(
    await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(credentials))
  );
}

function acceptInvite(harness: Harness, session: string, token: string) {
  return harness.post(REMOTE_PATHS.inviteAccept, { token }, { session });
}

function addMember(harness: Harness, credentials: MachineCredentials, userId: string) {
  return harness.post(REMOTE_PATHS.machineMemberAdd, { userId }, machineAuth(credentials));
}

async function listInstances(harness: Harness, session: string) {
  return readJson<RemoteInstance[]>(await harness.call(REMOTE_PATHS.instances, { session }));
}

async function readHeartbeat(harness: Harness, credentials: MachineCredentials) {
  return readJson<HeartbeatResponse>(await heartbeat(harness, credentials));
}

async function readCode(response: Response) {
  return (await readJson<{ error: { code: string } }>(response)).error.code;
}

async function shareMachine() {
  const harness = createHarness();
  const mona = await harness.signIn('mona', 1, 'Mona Lisa');
  const kai = await harness.signIn('kai', 2);
  const studio = await pairMachine(harness, mona);
  const invite = await createInvite(harness, studio);
  return { harness, mona, kai, studio, invite };
}

async function joinMachine() {
  const shared = await shareMachine();
  await acceptInvite(shared.harness, shared.kai, shared.invite.token);
  await addMember(shared.harness, shared.studio, KAI.id);
  return shared;
}

describe('machine members', () => {
  test('opening an invite gives a connect token to ask the machine, without making a member', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    const stored = harness.db.sqlite.query('SELECT token_hash FROM instance_invites').all() as {
      token_hash: string;
    }[];
    expect(stored[0]?.token_hash).not.toBe(invite.token);
    const accepted = await readJson<InviteAcceptResponse>(await acceptInvite(harness, kai, invite.token));
    expect(accepted).toMatchObject({ instanceId: studio.instanceId, name: 'Studio', owner: MONA, user: KAI });
    const token = new URL(accepted.connect.url).searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim?.userId).toBe(KAI.id);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect((await readHeartbeat(harness, studio)).members).toEqual([]);
  });

  test('the invite link works for anyone, as often as it is opened', async () => {
    const { harness, kai, invite } = await shareMachine();
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(200);
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(200);
    expect((await acceptInvite(harness, await harness.signIn('lee', 3), invite.token)).status).toBe(200);
  });

  test('a new invite replaces the old one, and turning it off stops it', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    const next = await createInvite(harness, studio);
    const stale = await acceptInvite(harness, kai, invite.token);
    expect(stale.status).toBe(404);
    expect(await readCode(stale)).toBe('invite_invalid');
    expect((await acceptInvite(harness, kai, next.token)).status).toBe(200);
    const off = await harness.post(REMOTE_PATHS.machineInviteRemove, {}, machineAuth(studio));
    expect(off.status).toBe(200);
    expect((await acceptInvite(harness, kai, next.token)).status).toBe(404);
  });

  test('the machine looks up only who asked, who is a member or its owner', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    const find = (userId: string) =>
      harness.post(REMOTE_PATHS.machineRequester, { userId }, machineAuth(studio));
    expect((await find(KAI.id)).status).toBe(404);
    await acceptInvite(harness, kai, invite.token);
    expect(await readJson<RemoteUser>(await find(KAI.id))).toEqual(KAI);
    expect(await readJson<RemoteUser>(await find(MONA.id))).toEqual(MONA);
    expect((await find('99')).status).toBe(404);
  });

  test('accepting a request on the machine makes the account a member, once', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    expect((await addMember(harness, studio, KAI.id)).status).toBe(404);
    await acceptInvite(harness, kai, invite.token);
    const added = await readJson<RemoteMember>(await addMember(harness, studio, KAI.id));
    expect(added).toEqual({ user: KAI, addedAt: harness.clock.now });
    expect((await addMember(harness, studio, KAI.id)).status).toBe(200);
    expect((await readHeartbeat(harness, studio)).members).toEqual([
      { user: KAI, addedAt: harness.clock.now },
    ]);
    expect(await listInstances(harness, kai)).toEqual([
      expect.objectContaining({ id: studio.instanceId, owner: MONA, role: 'member' }),
    ]);
    const connect = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(connect.status).toBe(200);
  });

  test('the owner asking through their own invite never becomes a member', async () => {
    const { harness, mona, studio, invite } = await shareMachine();
    await acceptInvite(harness, mona, invite.token);
    expect((await addMember(harness, studio, MONA.id)).status).toBe(200);
    expect((await readHeartbeat(harness, studio)).members).toEqual([]);
  });

  test('the machine removes a member, who then loses the machine and its connect tokens', async () => {
    const { harness, kai, studio } = await joinMachine();
    const removed = await harness.post(
      REMOTE_PATHS.machineMemberRemove,
      { userId: KAI.id },
      machineAuth(studio)
    );
    expect(removed.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    const connect = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(connect.status).toBe(404);
  });

  test('a member leaves a shared machine, and the owner cannot leave their own', async () => {
    const { harness, mona, kai, studio } = await joinMachine();
    const ownerLeaves = await harness.post(
      resolveInstanceLeavePath(studio.instanceId),
      {},
      { session: mona }
    );
    expect(ownerLeaves.status).toBe(409);
    const left = await harness.post(resolveInstanceLeavePath(studio.instanceId), {}, { session: kai });
    expect(left.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    const again = await harness.post(resolveInstanceLeavePath(studio.instanceId), {}, { session: kai });
    expect(again.status).toBe(404);
  });

  test('only the owner removes the machine, which drops its members and invite', async () => {
    const { harness, mona, kai, studio, invite } = await joinMachine();
    const byMember = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: kai });
    expect(byMember.status).toBe(403);
    expect(await readCode(byMember)).toBe('not_owner');
    const byOwner = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect(byOwner.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect(harness.db.sqlite.query('SELECT * FROM instance_members').all()).toEqual([]);
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(404);
  });

  test('an invite of a machine removed behind its back is refused', async () => {
    const { harness, mona, kai, studio, invite } = await shareMachine();
    harness.db.sqlite.exec('PRAGMA foreign_keys = OFF');
    await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(404);
  });

  test('opening an invite needs a signed-in page request', async () => {
    const { harness, kai, invite } = await shareMachine();
    expect((await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token })).status).toBe(401);
    const crossSite = await harness.post(
      REMOTE_PATHS.inviteAccept,
      { token: invite.token },
      { session: kai, sameOrigin: false }
    );
    expect(crossSite.status).toBe(403);
  });

  test('refuses a new member once the machine is full', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    for (let index = 0; index < MAX_INSTANCE_MEMBERS; index++) {
      harness.db.sqlite
        .query('INSERT INTO users (id, login, created_at) VALUES (?, ?, 0)')
        .run(`filler-${index}`, `filler-${index}`);
      harness.db.sqlite
        .query('INSERT INTO instance_members (instance_id, user_id, added_at) VALUES (?, ?, 0)')
        .run(studio.instanceId, `filler-${index}`);
    }
    await acceptInvite(harness, kai, invite.token);
    const refused = await addMember(harness, studio, KAI.id);
    expect(refused.status).toBe(409);
    expect(await readCode(refused)).toBe('members_full');
  });

  test('shared machines do not count toward the machines a member may pair', async () => {
    const { harness, kai } = await joinMachine();
    for (let index = 0; index < MAX_INSTANCES_PER_USER; index++)
      await pairMachine(harness, kai, `Kai ${index}`);
    expect(await listInstances(harness, kai)).toHaveLength(MAX_INSTANCES_PER_USER + 1);
  });

  test('member routes need the machine token', async () => {
    const harness = createHarness();
    for (const path of [
      REMOTE_PATHS.machineInvites,
      REMOTE_PATHS.machineInviteRemove,
      REMOTE_PATHS.machineRequester,
      REMOTE_PATHS.machineMemberAdd,
      REMOTE_PATHS.machineMemberRemove,
    ])
      expect((await harness.post(path, { userId: '2' }, { bearer: 'nope', sameOrigin: false })).status).toBe(
        401
      );
  });
});

describe('a shared machine and Slack', () => {
  test('a member cannot connect Slack to a machine they do not own, named or picked for them', async () => {
    const { harness, kai, studio } = await joinMachine();
    const named = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${studio.instanceId}`, {
      session: kai,
    });
    expect(named.status).toBe(403);
    const picked = await harness.call(SLACK_RELAY_PATHS.connect, { session: kai });
    expect(picked.headers.get('location')).toBe('/slack/linked?error=no_machine');
  });
});
