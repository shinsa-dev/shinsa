import { describe, expect, test } from 'bun:test';
import {
  type HeartbeatResponse,
  INVITE_TTL_MS,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  MAX_INSTANCE_MEMBERS,
  MAX_PENDING_INVITES,
  type MachineCredentials,
  REMOTE_PATHS,
  type RemoteInstance,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstanceRemovePath,
  verifyConnectToken,
} from '@shinsa/core';
import { MAX_INSTANCES_PER_USER } from '../src/pairing.ts';
import { createHarness, type Harness, heartbeat, pairMachine, readJson } from './harness.ts';

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

async function listInstances(harness: Harness, session: string) {
  return readJson<RemoteInstance[]>(await harness.call(REMOTE_PATHS.instances, { session }));
}

async function readHeartbeat(harness: Harness, credentials: MachineCredentials) {
  return readJson<HeartbeatResponse>(await heartbeat(harness, credentials));
}

async function shareMachine() {
  const harness = createHarness();
  const mona = await harness.signIn('mona', 1, 'Mona Lisa');
  const kai = await harness.signIn('kai', 2);
  const studio = await pairMachine(harness, mona);
  const invite = await createInvite(harness, studio);
  return { harness, mona, kai, studio, invite };
}

describe('machine members', () => {
  test('an invite made by the machine lets any signed-in account join it once', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    expect(invite.expiresAt).toBe(harness.clock.now + INVITE_TTL_MS);
    const stored = harness.db.sqlite.query('SELECT token_hash FROM instance_invites').all() as {
      token_hash: string;
    }[];
    expect(stored[0]?.token_hash).not.toBe(invite.token);
    const accepted = await acceptInvite(harness, kai, invite.token);
    expect(accepted.status).toBe(200);
    expect(await readJson<InviteAcceptResponse>(accepted)).toEqual({
      instanceId: studio.instanceId,
      name: 'Studio',
      owner: { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null },
    });
    const again = await acceptInvite(harness, await harness.signIn('lee', 3), invite.token);
    expect(again.status).toBe(404);
    expect((await readJson<{ error: { code: string } }>(again)).error.code).toBe('invite_invalid');
  });

  test('a member sees the shared machine with its owner, and the owner sees it as theirs', async () => {
    const { harness, mona, kai, studio, invite } = await shareMachine();
    expect(await listInstances(harness, kai)).toEqual([]);
    await acceptInvite(harness, kai, invite.token);
    const shared = await listInstances(harness, kai);
    expect(shared).toEqual([
      expect.objectContaining({
        id: studio.instanceId,
        owner: { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null },
        role: 'member',
      }),
    ]);
    expect((await listInstances(harness, mona))[0]?.role).toBe('owner');
  });

  test('a member gets connect tokens for the machine, signed for their own account', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    const before = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(before.status).toBe(404);
    await acceptInvite(harness, kai, invite.token);
    const connect = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(connect.status).toBe(200);
    const token = new URL((await readJson<{ url: string }>(connect)).url).searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim?.userId).toBe('2');
  });

  test('the heartbeat answers with the owner and the members', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    expect(await readHeartbeat(harness, studio)).toEqual({
      ok: true,
      owner: { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null },
      members: [],
    });
    await acceptInvite(harness, kai, invite.token);
    expect((await readHeartbeat(harness, studio)).members).toEqual([
      { user: { id: '2', login: 'kai', name: null, avatarUrl: null }, addedAt: harness.clock.now },
    ]);
  });

  test('the machine removes a member, who then loses the machine and its connect tokens', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    await acceptInvite(harness, kai, invite.token);
    const removed = await harness.post(
      REMOTE_PATHS.machineMemberRemove,
      { userId: '2' },
      machineAuth(studio)
    );
    expect(removed.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect((await readHeartbeat(harness, studio)).members).toEqual([]);
    const connect = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(connect.status).toBe(404);
  });

  test('a member leaves a shared machine, and the owner cannot leave their own', async () => {
    const { harness, mona, kai, studio, invite } = await shareMachine();
    await acceptInvite(harness, kai, invite.token);
    const ownerLeaves = await harness.post(
      resolveInstanceLeavePath(studio.instanceId),
      {},
      { session: mona }
    );
    expect(ownerLeaves.status).toBe(409);
    const left = await harness.post(resolveInstanceLeavePath(studio.instanceId), {}, { session: kai });
    expect(left.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    const strangerLeaves = await harness.post(
      resolveInstanceLeavePath(studio.instanceId),
      {},
      { session: kai }
    );
    expect(strangerLeaves.status).toBe(404);
  });

  test('only the owner removes the machine', async () => {
    const { harness, mona, kai, studio, invite } = await shareMachine();
    await acceptInvite(harness, kai, invite.token);
    const byMember = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: kai });
    expect(byMember.status).toBe(403);
    expect((await readJson<{ error: { code: string } }>(byMember)).error.code).toBe('not_owner');
    const byOwner = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect(byOwner.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect(harness.db.sqlite.query('SELECT * FROM instance_members').all()).toEqual([]);
  });

  test('the owner opening their own invite uses it up without becoming a member', async () => {
    const { harness, mona, studio, invite } = await shareMachine();
    expect((await acceptInvite(harness, mona, invite.token)).status).toBe(200);
    expect((await readHeartbeat(harness, studio)).members).toEqual([]);
    expect((await acceptInvite(harness, mona, invite.token)).status).toBe(404);
  });

  test('an invite expires, and an unknown one is refused', async () => {
    const { harness, kai, invite } = await shareMachine();
    expect((await acceptInvite(harness, kai, 'not-a-token')).status).toBe(404);
    harness.clock.now += INVITE_TTL_MS;
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(404);
  });

  test('an invite of a removed machine is refused', async () => {
    const { harness, mona, kai, studio, invite } = await shareMachine();
    harness.db.sqlite.exec('PRAGMA foreign_keys = OFF');
    await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect((await acceptInvite(harness, kai, invite.token)).status).toBe(404);
  });

  test('accepting needs a signed-in page request', async () => {
    const { harness, kai, invite } = await shareMachine();
    expect((await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token })).status).toBe(401);
    const crossSite = await harness.post(
      REMOTE_PATHS.inviteAccept,
      { token: invite.token },
      { session: kai, sameOrigin: false }
    );
    expect(crossSite.status).toBe(403);
  });

  test('keeps at most a few invites waiting per machine, and expired ones make room', async () => {
    const { harness, studio } = await shareMachine();
    for (let index = 1; index < MAX_PENDING_INVITES; index++) await createInvite(harness, studio);
    const full = await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(studio));
    expect(full.status).toBe(429);
    harness.clock.now += INVITE_TTL_MS;
    expect((await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(studio))).status).toBe(200);
  });

  test('refuses a new member once the machine is full, and still lets a member back in', async () => {
    const { harness, kai, studio, invite } = await shareMachine();
    await acceptInvite(harness, kai, invite.token);
    for (let index = 1; index < MAX_INSTANCE_MEMBERS; index++)
      harness.db.sqlite
        .query('INSERT INTO users (id, login, created_at) VALUES (?, ?, 0)')
        .run(`filler-${index}`, `filler-${index}`);
    for (let index = 1; index < MAX_INSTANCE_MEMBERS; index++)
      harness.db.sqlite
        .query('INSERT INTO instance_members (instance_id, user_id, added_at) VALUES (?, ?, 0)')
        .run(studio.instanceId, `filler-${index}`);
    const next = await createInvite(harness, studio);
    const refused = await acceptInvite(harness, await harness.signIn('lee', 3), next.token);
    expect(refused.status).toBe(409);
    expect((await readJson<{ error: { code: string } }>(refused)).error.code).toBe('members_full');
    expect((await acceptInvite(harness, kai, next.token)).status).toBe(200);
  });

  test('shared machines do not count toward the machines a member may pair', async () => {
    const { harness, kai, invite } = await shareMachine();
    await acceptInvite(harness, kai, invite.token);
    for (let index = 0; index < MAX_INSTANCES_PER_USER; index++)
      await pairMachine(harness, kai, `Kai ${index}`);
    expect(await listInstances(harness, kai)).toHaveLength(MAX_INSTANCES_PER_USER + 1);
  });

  test('member routes need the machine token', async () => {
    const harness = createHarness();
    const invite = await harness.post(REMOTE_PATHS.machineInvites, {}, { sameOrigin: false });
    expect(invite.status).toBe(401);
    const remove = await harness.post(
      REMOTE_PATHS.machineMemberRemove,
      { userId: '2' },
      { bearer: 'nope', sameOrigin: false }
    );
    expect(remove.status).toBe(401);
  });
});
