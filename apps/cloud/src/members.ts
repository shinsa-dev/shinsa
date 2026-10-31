import {
  INVITE_TTL_MS,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  MAX_INSTANCE_MEMBERS,
  MAX_PENDING_INVITES,
  type RemoteMember,
} from '@shinsa/core';
import { createToken, resolveTokenHash } from './crypto.ts';
import type { InstanceRow } from './database.ts';
import { CloudError, readJsonFields, readText, respondJson } from './http.ts';
import { findInstanceAccess, findMachine } from './instances.ts';
import { findPageUser, serializeUser } from './session.ts';
import type { CloudWorld } from './world.ts';

const INVITE_INVALID = new CloudError(
  'invite_invalid',
  'This invite expired or was already used. Ask for a new one.',
  404
);

export async function listInstanceMembers(row: InstanceRow, world: CloudWorld) {
  const owner = await world.store.selectUser(row.user_id);
  if (!owner) throw new CloudError('not_found', 'No such machine.', 404);
  const members: RemoteMember[] = (await world.store.listMembers(row.id)).map((member) => ({
    user: serializeUser(member),
    addedAt: member.added_at,
  }));
  return { owner: serializeUser(owner), members };
}

export async function respondInviteCreate(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  const now = world.now();
  await world.store.removeExpiredInvites(now);
  if ((await world.store.countPendingInvites(row.id)) >= MAX_PENDING_INVITES)
    throw new CloudError(
      'invites_full',
      `This machine has ${MAX_PENDING_INVITES} invites waiting. Wait for one to be used or expire, then try again.`,
      429
    );
  const token = createToken();
  const expiresAt = now + INVITE_TTL_MS;
  await world.store.createInvite(await resolveTokenHash(token), row.id, expiresAt);
  const answer: InviteCreateResponse = { token, expiresAt };
  return respondJson(answer);
}

async function assertRoomForMember(row: InstanceRow, userId: string, world: CloudWorld) {
  if (row.user_id === userId || (await world.store.isMember(row.id, userId))) return;
  if ((await world.store.countMembers(row.id)) >= MAX_INSTANCE_MEMBERS)
    throw new CloudError(
      'members_full',
      `This machine already has ${MAX_INSTANCE_MEMBERS} members. Its owner has to remove one first.`,
      409
    );
}

async function claimInvite(row: InstanceRow, tokenHash: string, userId: string, world: CloudWorld) {
  const now = world.now();
  await assertRoomForMember(row, userId, world);
  if (!(await world.store.claimInvite(tokenHash, userId, now))) throw INVITE_INVALID;
  if (row.user_id !== userId) await world.store.createMember(row.id, userId, now);
}

async function isAcceptedAgain(row: InstanceRow, claimedBy: string, userId: string, world: CloudWorld) {
  if (claimedBy !== userId) return false;
  return row.user_id === userId || world.store.isMember(row.id, userId);
}

export async function respondInviteAccept(request: Request, world: CloudWorld) {
  const user = await findPageUser(request, world);
  const fields = await readJsonFields(request);
  const tokenHash = await resolveTokenHash(readText(fields, 'token', 100));
  const now = world.now();
  const invite = await world.store.selectInvite(tokenHash);
  if (!invite || invite.expires_at <= now) throw INVITE_INVALID;
  const row = await world.store.selectInstance(invite.instance_id);
  if (!row) throw INVITE_INVALID;
  if (invite.claimed_by === null) await claimInvite(row, tokenHash, user.id, world);
  else if (!(await isAcceptedAgain(row, invite.claimed_by, user.id, world))) throw INVITE_INVALID;
  const { owner } = await listInstanceMembers(row, world);
  const answer: InviteAcceptResponse = { instanceId: row.id, name: row.name, owner };
  return respondJson(answer);
}

export async function respondInstanceLeave(request: Request, instanceId: string, world: CloudWorld) {
  const user = await findPageUser(request, world);
  const { row, role } = await findInstanceAccess(user, instanceId, world);
  if (role === 'owner')
    throw new CloudError('owner_cannot_leave', 'You own this machine. Remove it instead.', 409);
  await world.store.removeMember(row.id, user.id);
  return respondJson({ ok: true });
}

export async function respondMachineMemberRemove(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  const fields = await readJsonFields(request);
  await world.store.removeMember(row.id, readText(fields, 'userId', 64));
  return respondJson({ ok: true });
}
