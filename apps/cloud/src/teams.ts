import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  MAX_OWNED_TEAMS,
  MAX_TEAM_MEMBERS,
  type RemoteMember,
  type RemoteRole,
  type RemoteTeam,
  resolveTeamChannelUrl,
  resolveTunnelHost,
  TEAM_NAME_LIMIT,
  type TeamAction,
  type TeamCreateResponse,
  type TeamInviteResponse,
  type TeamJoinResponse,
  type TeamPreviewResponse,
} from '@shinsa/core';
import { createInstanceId, createToken, resolveTokenHash } from './crypto.ts';
import type { MemberRow, TeamRow, UserRow } from './database.ts';
import { CloudError, readJsonFields, readText, respondJson } from './http.ts';
import { findMachine, isInstanceOnline } from './instances.ts';
import { findPageUser, findSessionUser, serializeUser } from './session.ts';
import type { CloudWorld } from './world.ts';

export type TeamActor = 'machine' | 'page';

type TeamHandler = (request: Request, user: UserRow, teamId: string, world: CloudWorld) => Promise<Response>;

function serializeMember(member: MemberRow): RemoteMember {
  return { user: serializeUser(member), addedAt: member.added_at };
}

async function serializeTeam(team: TeamRow, userId: string, world: CloudWorld): Promise<RemoteTeam> {
  const owner = await world.store.selectUser(team.user_id);
  if (!owner) throw new CloudError('not_found', 'No such team.', 404);
  const role: RemoteRole = team.user_id === userId ? 'owner' : 'member';
  const now = world.now();
  const machines = (await world.store.listTeamInstances(team.id)).map((row) => ({
    id: row.id,
    name: row.name,
    userId: row.user_id,
    online: isInstanceOnline(row, now),
    lastSeenAt: row.last_seen_at,
  }));
  const requests: MemberRow[] = [];
  if (role === 'owner') requests.push(...(await world.store.listTeamRequesters(team.id)));
  return {
    id: team.id,
    name: team.name,
    owner: serializeUser(owner),
    role,
    members: (await world.store.listTeamMembers(team.id)).map(serializeMember),
    requests: requests.map(serializeMember),
    machines,
    createdAt: team.created_at,
  };
}

export async function listUserTeams(userId: string, world: CloudWorld) {
  const teams = await world.store.listUserTeams(userId);
  return Promise.all(teams.map((team) => serializeTeam(team, userId, world)));
}

async function findTeamUser(request: Request, actor: TeamActor, world: CloudWorld) {
  if (actor === 'page') return findPageUser(request, world);
  const row = await findMachine(request, world);
  const user = await world.store.selectUser(row.user_id);
  if (!user) throw new CloudError('revoked', 'This machine is not paired.', 401);
  return user;
}

async function findTeamAccess(user: UserRow, teamId: string, world: CloudWorld) {
  const team = await world.store.selectTeam(teamId);
  if (team?.user_id === user.id) return { team, role: 'owner' as RemoteRole };
  if (team && (await world.store.isTeamMember(team.id, user.id)))
    return { team, role: 'member' as RemoteRole };
  throw new CloudError('not_found', 'No such team.', 404);
}

async function findOwnTeam(user: UserRow, teamId: string, world: CloudWorld) {
  const { team, role } = await findTeamAccess(user, teamId, world);
  if (role !== 'owner') throw new CloudError('not_owner', "Only the team's owner can do this.", 403);
  return team;
}

async function replaceTeamInvite(teamId: string, world: CloudWorld) {
  const invite = createToken();
  await world.store.replaceTeamInvite(teamId, await resolveTokenHash(invite), world.now());
  return invite;
}

function readTeamName(fields: Record<string, unknown>) {
  const name = readText(fields, 'name', TEAM_NAME_LIMIT).trim();
  if (!name) throw new CloudError('body_invalid', 'Give the team a name.', 400);
  return name;
}

export async function respondTeams(request: Request, world: CloudWorld) {
  const user = await findSessionUser(request, world);
  return respondJson(await listUserTeams(user.id, world));
}

export async function respondTeamCreate(request: Request, world: CloudWorld) {
  const user = await findTeamUser(request, 'machine', world);
  const name = readTeamName(await readJsonFields(request));
  if ((await world.store.countOwnedTeams(user.id)) >= MAX_OWNED_TEAMS)
    throw new CloudError('teams_full', `You already own ${MAX_OWNED_TEAMS} teams. Remove one first.`, 409);
  const team: TeamRow = { id: createInstanceId(), user_id: user.id, name, created_at: world.now() };
  await world.store.createTeam(team);
  const invite = await replaceTeamInvite(team.id, world);
  const answer: TeamCreateResponse = { team: await serializeTeam(team, user.id, world), invite };
  return respondJson(answer);
}

async function findInviteTeam(request: Request, world: CloudWorld) {
  const fields = await readJsonFields(request);
  const team = await world.store.selectInviteTeam(await resolveTokenHash(readText(fields, 'invite', 100)));
  if (!team)
    throw new CloudError(
      'invite_invalid',
      'This team link was turned off. Ask the team’s owner for a new one.',
      404
    );
  const owner = await world.store.selectUser(team.user_id);
  if (!owner) throw new CloudError('not_found', 'No such team.', 404);
  return { team, owner };
}

export async function respondTeamPreview(request: Request, world: CloudWorld) {
  await findPageUser(request, world);
  const { team, owner } = await findInviteTeam(request, world);
  const answer: TeamPreviewResponse = { name: team.name, owner: serializeUser(owner) };
  return respondJson(answer);
}

export async function respondTeamJoin(request: Request, actor: TeamActor, world: CloudWorld) {
  const user = await findTeamUser(request, actor, world);
  const { team, owner } = await findInviteTeam(request, world);
  const member = team.user_id === user.id || (await world.store.isTeamMember(team.id, user.id));
  if (!member) await world.store.recordTeamRequester(team.id, user.id, world.now());
  const answer: TeamJoinResponse = {
    teamId: team.id,
    name: team.name,
    owner: serializeUser(owner),
    status: member ? 'member' : 'requested',
  };
  return respondJson(answer);
}

async function respondInvite(_request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  const answer: TeamInviteResponse = { invite: await replaceTeamInvite(team.id, world) };
  return respondJson(answer);
}

async function respondInviteRemove(_request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  await world.store.removeTeamInvite(team.id);
  return respondJson({ ok: true });
}

async function respondMemberAdd(request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  const userId = readText(await readJsonFields(request), 'userId', 64);
  const inTeam = team.user_id === userId || (await world.store.isTeamMember(team.id, userId));
  const asked = await world.store.isTeamRequester(team.id, userId);
  const added = await world.store.selectUser(userId);
  if (!(added && (inTeam || asked)))
    throw new CloudError('not_found', 'No one with that account asked to join this team.', 404);
  const now = world.now();
  if (!inTeam) {
    if ((await world.store.countTeamMembers(team.id)) >= MAX_TEAM_MEMBERS)
      throw new CloudError(
        'members_full',
        `This team already has ${MAX_TEAM_MEMBERS} members. Remove one first.`,
        409
      );
    await world.store.createTeamMember(team.id, userId, now);
  }
  await world.store.removeTeamRequester(team.id, userId);
  const member: RemoteMember = { user: serializeUser(added), addedAt: now };
  return respondJson(member);
}

async function respondRequestDecline(request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  await world.store.removeTeamRequester(team.id, readText(await readJsonFields(request), 'userId', 64));
  return respondJson({ ok: true });
}

async function respondMemberRemove(request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  await world.store.removeTeamMember(team.id, readText(await readJsonFields(request), 'userId', 64));
  return respondJson({ ok: true });
}

async function respondRemove(_request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const team = await findOwnTeam(user, teamId, world);
  await world.store.removeTeam(team.id);
  return respondJson({ ok: true });
}

async function respondLeave(_request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const { team, role } = await findTeamAccess(user, teamId, world);
  if (role === 'owner')
    throw new CloudError('owner_cannot_leave', 'You own this team. Remove it instead.', 409);
  await world.store.removeTeamMember(team.id, user.id);
  return respondJson({ ok: true });
}

async function respondConnect(request: Request, user: UserRow, teamId: string, world: CloudWorld) {
  const { team } = await findTeamAccess(user, teamId, world);
  const instanceId = readText(await readJsonFields(request), 'instanceId', 64);
  const row = (await world.store.listTeamInstances(team.id)).find((instance) => instance.id === instanceId);
  if (!row) throw new CloudError('not_found', 'That machine is not in this team.', 404);
  const expiresAt = world.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(row.connect_key, { instanceId: row.id, userId: user.id, expiresAt });
  const answer: ConnectResponse = {
    url: resolveTeamChannelUrl(`wss://${resolveTunnelHost(row.id)}`, token),
    expiresAt,
  };
  return respondJson(answer);
}

const TEAM_HANDLERS: Record<TeamAction, TeamHandler> = {
  invite: respondInvite,
  'invite/remove': respondInviteRemove,
  'members/add': respondMemberAdd,
  'members/remove': respondMemberRemove,
  'requests/decline': respondRequestDecline,
  leave: respondLeave,
  remove: respondRemove,
  connect: respondConnect,
};

export const TEAM_ACTIONS = Object.keys(TEAM_HANDLERS) as TeamAction[];

export const PAGE_TEAM_ACTIONS: TeamAction[] = ['leave', 'connect'];

export async function respondTeamAction(
  request: Request,
  actor: TeamActor,
  teamId: string,
  action: TeamAction,
  world: CloudWorld
) {
  const user = await findTeamUser(request, actor, world);
  return TEAM_HANDLERS[action](request, user, teamId, world);
}
