import { describe, expect, test } from 'bun:test';
import {
  type HeartbeatResponse,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  MAX_INSTANCE_GUESTS,
  type MachineCredentials,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteMember,
  type RemoteUser,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstanceRemovePath,
  verifyConnectToken,
} from '@shinsa/core';
import { createHarness, type Harness, heartbeat, pairMachine, readJson } from './harness.ts';

const MONA: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI: RemoteUser = { id: '2', login: 'kai', name: null, avatarUrl: null };

function machineAuth(credentials: MachineCredentials) {
  return { bearer: credentials.machineToken, sameOrigin: false };
}

async function createHandoff(harness: Harness, credentials: MachineCredentials) {
  return readJson<InviteCreateResponse>(
    await harness.post(REMOTE_PATHS.machineHandoffs, {}, machineAuth(credentials))
  );
}

function removeHandoff(harness: Harness, credentials: MachineCredentials, token: string) {
  return harness.post(REMOTE_PATHS.machineHandoffRemove, { token }, machineAuth(credentials));
}

function acceptHandoff(harness: Harness, session: string, token: string) {
  return harness.post(REMOTE_PATHS.handoffAccept, { token }, { session });
}

function addGuest(harness: Harness, credentials: MachineCredentials, userId: string) {
  return harness.post(REMOTE_PATHS.machineGuestAdd, { userId }, machineAuth(credentials));
}

function removeGuest(harness: Harness, credentials: MachineCredentials, userId: string) {
  return harness.post(REMOTE_PATHS.machineGuestRemove, { userId }, machineAuth(credentials));
}

function connect(harness: Harness, session: string, instanceId: string) {
  return harness.post(resolveInstanceConnectPath(instanceId), {}, { session });
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

async function handOff() {
  const harness = createHarness();
  const mona = await harness.signIn('mona', 1, 'Mona Lisa');
  const kai = await harness.signIn('kai', 2);
  const studio = await pairMachine(harness, mona);
  const handoff = await createHandoff(harness, studio);
  return { harness, mona, kai, studio, handoff };
}

async function claimTask() {
  const handed = await handOff();
  await acceptHandoff(handed.harness, handed.kai, handed.handoff.token);
  await addGuest(handed.harness, handed.studio, KAI.id);
  return handed;
}

describe('hand-off links', () => {
  test('opening one gives a connect token to claim the task, without making a guest', async () => {
    const { harness, kai, studio, handoff } = await handOff();
    const stored = harness.db.sqlite.query('SELECT token_hash FROM instance_handoffs').all() as {
      token_hash: string;
    }[];
    expect(stored[0]?.token_hash).not.toBe(handoff.token);
    const accepted = await readJson<InviteAcceptResponse>(await acceptHandoff(harness, kai, handoff.token));
    expect(accepted).toMatchObject({ instanceId: studio.instanceId, name: 'Studio', owner: MONA, user: KAI });
    const token = new URL(accepted.connect.url).searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim?.userId).toBe(KAI.id);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect((await readHeartbeat(harness, studio)).guests).toEqual([]);
  });

  test('each hand-off has its own link, and removing one leaves the others', async () => {
    const { harness, kai, studio, handoff } = await handOff();
    const second = await createHandoff(harness, studio);
    expect(second.token).not.toBe(handoff.token);
    expect((await removeHandoff(harness, studio, handoff.token)).status).toBe(200);
    const removed = await acceptHandoff(harness, kai, handoff.token);
    expect(removed.status).toBe(404);
    expect(await readCode(removed)).toBe('handoff_invalid');
    expect((await acceptHandoff(harness, kai, second.token)).status).toBe(200);
  });

  test('a machine cannot remove another machine’s hand-off link', async () => {
    const { harness, mona, kai, handoff } = await handOff();
    const laptop = await pairMachine(harness, mona, 'Laptop');
    await removeHandoff(harness, laptop, handoff.token);
    expect((await acceptHandoff(harness, kai, handoff.token)).status).toBe(200);
  });

  test('an invite link is not a hand-off link, nor the other way round', async () => {
    const { harness, kai, studio, handoff } = await handOff();
    const invite = await readJson<InviteCreateResponse>(
      await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(studio))
    );
    expect((await acceptHandoff(harness, kai, invite.token)).status).toBe(404);
    expect(
      (await harness.post(REMOTE_PATHS.inviteAccept, { token: handoff.token }, { session: kai })).status
    ).toBe(404);
  });

  test('opening one needs a signed-in page request', async () => {
    const { harness, kai, handoff } = await handOff();
    expect((await harness.post(REMOTE_PATHS.handoffAccept, { token: handoff.token })).status).toBe(401);
    const crossSite = await harness.post(
      REMOTE_PATHS.handoffAccept,
      { token: handoff.token },
      { session: kai, sameOrigin: false }
    );
    expect(crossSite.status).toBe(403);
  });

  test('a hand-off of a machine removed behind its back is refused', async () => {
    const { harness, mona, kai, studio, handoff } = await handOff();
    harness.db.sqlite.exec('PRAGMA foreign_keys = OFF');
    await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect((await acceptHandoff(harness, kai, handoff.token)).status).toBe(404);
  });
});

describe('guests of a machine', () => {
  test('the machine makes only who opened its link a guest, who then lists and reaches it', async () => {
    const { harness, kai, studio, handoff } = await handOff();
    expect((await addGuest(harness, studio, KAI.id)).status).toBe(404);
    await acceptHandoff(harness, kai, handoff.token);
    const added = await readJson<RemoteMember>(await addGuest(harness, studio, KAI.id));
    expect(added).toEqual({ user: KAI, addedAt: harness.clock.now });
    expect(harness.db.sqlite.query('SELECT * FROM instance_requesters').all()).toEqual([]);
    expect((await addGuest(harness, studio, KAI.id)).status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([
      expect.objectContaining({ id: studio.instanceId, owner: MONA, role: 'guest' }),
    ]);
    expect((await connect(harness, kai, studio.instanceId)).status).toBe(200);
    const access = await readHeartbeat(harness, studio);
    expect(access.guests).toEqual([{ user: KAI, addedAt: harness.clock.now }]);
    expect(access.members).toEqual([]);
  });

  test('claiming a second task on the same machine keeps one guest', async () => {
    const { harness, kai, studio } = await claimTask();
    const second = await createHandoff(harness, studio);
    await acceptHandoff(harness, kai, second.token);
    expect((await addGuest(harness, studio, KAI.id)).status).toBe(200);
    expect((await readHeartbeat(harness, studio)).guests).toHaveLength(1);
  });

  test('the owner or a member claiming a task stays what they are', async () => {
    const { harness, mona, kai, studio, handoff } = await handOff();
    const invite = await readJson<InviteCreateResponse>(
      await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(studio))
    );
    await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token }, { session: kai });
    await harness.post(REMOTE_PATHS.machineMemberAdd, { userId: KAI.id }, machineAuth(studio));
    for (const [session, user] of [
      [mona, MONA],
      [kai, KAI],
    ] as const) {
      await acceptHandoff(harness, session, handoff.token);
      expect((await addGuest(harness, studio, user.id)).status).toBe(200);
    }
    expect((await readHeartbeat(harness, studio)).guests).toEqual([]);
    expect(await listInstances(harness, kai)).toEqual([expect.objectContaining({ role: 'member' })]);
    expect(await listInstances(harness, mona)).toEqual([expect.objectContaining({ role: 'owner' })]);
  });

  test('refuses a new guest once the machine is full', async () => {
    const { harness, kai, studio, handoff } = await handOff();
    for (let index = 0; index < MAX_INSTANCE_GUESTS; index++) {
      harness.db.sqlite
        .query('INSERT INTO users (id, login, created_at) VALUES (?, ?, 0)')
        .run(`filler-${index}`, `filler-${index}`);
      harness.db.sqlite
        .query('INSERT INTO instance_guests (instance_id, user_id, added_at) VALUES (?, ?, 0)')
        .run(studio.instanceId, `filler-${index}`);
    }
    await acceptHandoff(harness, kai, handoff.token);
    const refused = await addGuest(harness, studio, KAI.id);
    expect(refused.status).toBe(409);
    expect(await readCode(refused)).toBe('guests_full');
  });

  test('the machine removes a guest, who then loses the machine and its connect tokens', async () => {
    const { harness, kai, studio } = await claimTask();
    expect((await removeGuest(harness, studio, KAI.id)).status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect((await connect(harness, kai, studio.instanceId)).status).toBe(404);
    expect((await readHeartbeat(harness, studio)).guests).toEqual([]);
  });

  test('a guest leaves the machine, once', async () => {
    const { harness, kai, studio } = await claimTask();
    const left = await harness.post(resolveInstanceLeavePath(studio.instanceId), {}, { session: kai });
    expect(left.status).toBe(200);
    expect(await listInstances(harness, kai)).toEqual([]);
    expect((await readHeartbeat(harness, studio)).guests).toEqual([]);
    const again = await harness.post(resolveInstanceLeavePath(studio.instanceId), {}, { session: kai });
    expect(again.status).toBe(404);
  });

  test('a guest cannot remove the machine, and its owner removing it drops guests and links', async () => {
    const { harness, mona, kai, studio } = await claimTask();
    const pending = await createHandoff(harness, studio);
    const byGuest = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: kai });
    expect(byGuest.status).toBe(403);
    expect(await readCode(byGuest)).toBe('not_owner');
    await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session: mona });
    expect(await listInstances(harness, kai)).toEqual([]);
    expect(harness.db.sqlite.query('SELECT * FROM instance_guests').all()).toEqual([]);
    expect((await acceptHandoff(harness, kai, pending.token)).status).toBe(404);
  });

  test('guest and hand-off routes need the machine token', async () => {
    const harness = createHarness();
    for (const path of [
      REMOTE_PATHS.machineHandoffs,
      REMOTE_PATHS.machineHandoffRemove,
      REMOTE_PATHS.machineGuestAdd,
      REMOTE_PATHS.machineGuestRemove,
    ])
      expect(
        (await harness.post(path, { userId: '2', token: 'x' }, { bearer: 'nope', sameOrigin: false })).status
      ).toBe(401);
  });
});
