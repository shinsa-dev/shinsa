import {
  type InviteAcceptResponse,
  type InviteCreateResponse,
  MAX_INSTANCE_MEMBERS,
  type RemoteMember,
} from '@shinsa/core';
import { createToken, resolveTokenHash } from './crypto.ts';
import type { InstanceRow } from './database.ts';
import { CloudError, readJsonFields, readText, respondJson } from './http.ts';
import { createConnectAnswer, findInstanceAccess, findMachine } from './instances.ts';
import { findPageUser, serializeUser } from './session.ts';
import type { CloudWorld } from './world.ts';

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
  const token = createToken();
  await world.store.replaceInvite(row.id, await resolveTokenHash(token), world.now());
  const answer: InviteCreateResponse = { token };
  return respondJson(answer);
}

export async function respondInviteRemove(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  await world.store.removeInvite(row.id);
  return respondJson({ ok: true });
}

async function selectInviteMachine(tokenHash: string, world: CloudWorld) {
  const instanceId = await world.store.selectInviteInstance(tokenHash);
  if (!instanceId) return null;
  return world.store.selectInstance(instanceId);
}

async function selectAskingUser(row: InstanceRow, userId: string, world: CloudWorld) {
  const asked =
    row.user_id === userId ||
    (await world.store.isMember(row.id, userId)) ||
    (await world.store.isRequester(row.id, userId)) ||
    (await world.store.sharesTeam(row.user_id, userId));
  if (!asked) return null;
  return world.store.selectUser(userId);
}

export async function respondInviteAccept(request: Request, world: CloudWorld) {
  const user = await findPageUser(request, world);
  const fields = await readJsonFields(request);
  const tokenHash = await resolveTokenHash(readText(fields, 'token', 100));
  const row = await selectInviteMachine(tokenHash, world);
  if (!row)
    throw new CloudError(
      'invite_invalid',
      'This invite link was turned off. Ask the machine’s owner for a new one.',
      404
    );
  await world.store.recordRequester(row.id, user.id, world.now());
  const { owner } = await listInstanceMembers(row, world);
  const answer: InviteAcceptResponse = {
    instanceId: row.id,
    name: row.name,
    owner,
    user: serializeUser(user),
    connect: await createConnectAnswer(row, user.id, world),
  };
  return respondJson(answer);
}

async function findRequester(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  const fields = await readJsonFields(request);
  const userId = readText(fields, 'userId', 64);
  const user = await selectAskingUser(row, userId, world);
  if (!user)
    throw new CloudError(
      'not_found',
      'No one with that account asked to reach this machine or is in a team with you.',
      404
    );
  return { row, user };
}

export async function respondRequesterFind(request: Request, world: CloudWorld) {
  const { user } = await findRequester(request, world);
  return respondJson(serializeUser(user));
}

export async function respondMachineMemberAdd(request: Request, world: CloudWorld) {
  const { row, user } = await findRequester(request, world);
  const now = world.now();
  if (row.user_id !== user.id && !(await world.store.isMember(row.id, user.id))) {
    if ((await world.store.countMembers(row.id)) >= MAX_INSTANCE_MEMBERS)
      throw new CloudError(
        'members_full',
        `This machine already has ${MAX_INSTANCE_MEMBERS} members. Remove one first.`,
        409
      );
    await world.store.createMember(row.id, user.id, now);
  }
  await world.store.removeRequester(row.id, user.id);
  const member: RemoteMember = { user: serializeUser(user), addedAt: now };
  return respondJson(member);
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
