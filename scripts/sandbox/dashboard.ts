import { Clock, Effect, Schema } from 'effect';
import {
  type InviteAcceptResponse,
  type InviteCreateResponse,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteMember,
  type RemoteRole,
  type RemoteUser,
  resolveKeyFingerprint,
} from '../../packages/core/src/index.ts';
import { DAY, MINUTE } from '../kit/time.ts';
import { createConnect, respondConnect, respondTeamConnect, respondTeamRemoteConnect } from './connect.ts';
import { respondPreviewOpen } from './previews.ts';
import { createRandomKey, parseRequestBody, readBearerMachine, readPreviewUser } from './requests.ts';
import { GUEST, type Machine, SandboxFailed, TEAMMATE, TokenBody, USER, UserBody } from './schema.ts';
import { respondSession } from './session.ts';
import { respondTeamScopes } from './team-scopes.ts';
import { MACHINE_OWNERS, respondTeams, TEAM, teammateLink } from './team.ts';

const GUEST_MACHINES = new Set<string>();

const MEMBER_MACHINES = new Set<string>();

const INVITES = new Map<string, string>();

const HANDOFFS = new Map<string, string>();

const decodeTokenBody = Schema.decodeUnknownEffect(Schema.fromJsonString(TokenBody));

const decodeUserBody = Schema.decodeUnknownEffect(Schema.fromJsonString(UserBody));

const describeInstance = Effect.fn('Sandbox.describeInstance')(function* (
  machine: Machine,
  owner: RemoteUser,
  role: RemoteRole
) {
  const now = yield* Clock.currentTimeMillis;
  const instance: RemoteInstance = {
    id: machine.id,
    name: machine.name,
    fingerprint: yield* resolveKeyFingerprint(machine.publicKey),
    online: owner.id === USER.id || teammateLink.online,
    lastSeenAt: now,
    createdAt: now - 7 * DAY,
    owner,
    role,
  };
  return instance;
});

const listInstances = Effect.fn('Sandbox.listInstances')(function* (
  machines: Machine[],
  teammates: Machine[],
  user: RemoteUser
) {
  const guest = user.id === GUEST.id;
  if (guest)
    return yield* Effect.forEach(
      machines.filter((machine) => GUEST_MACHINES.has(machine.id) || MEMBER_MACHINES.has(machine.id)),
      (machine) => describeInstance(machine, USER, resolvePreviewRole(guest, machine.id))
    );
  const own = yield* Effect.forEach(machines, (machine) => describeInstance(machine, USER, 'owner'));
  const theirs = user.id !== USER.id ? [] : teammates.filter((machine) => !machines.includes(machine));
  const shared = yield* Effect.forEach(theirs, (machine) =>
    describeInstance(machine, MACHINE_OWNERS[machine.id] ?? TEAMMATE, 'teammate')
  );
  return [...own, ...shared];
});

function respondInviteCreate(request: Request, machines: Machine[], tokens: Map<string, string>) {
  const bearer = readBearerMachine(request);
  const machine = machines.find((entry) => entry.id === bearer);
  if (!machine) return Response.json({ error: { code: 'revoked', message: 'Not paired.' } }, { status: 401 });
  const token = createRandomKey(16);
  tokens.set(token, machine.id);
  const answer: InviteCreateResponse = { token };
  return Response.json(answer);
}

const respondInviteAccept = Effect.fn('Sandbox.respondInviteAccept')(function* (
  request: Request,
  machines: Machine[],
  user: RemoteUser,
  tokens: Map<string, string>,
  code: string
) {
  const { token } = yield* parseRequestBody(request, decodeTokenBody);
  const machine = machines.find((entry) => entry.id === tokens.get(token ?? ''));
  if (!machine)
    return Response.json(
      { error: { code, message: 'This link was turned off. Ask the machine’s owner for a new one.' } },
      { status: 404 }
    );
  const answer: InviteAcceptResponse = {
    instanceId: machine.id,
    name: machine.name,
    owner: USER,
    user,
    connect: yield* createConnect(machine, user),
  };
  return Response.json(answer);
});

function resolvePreviewRole(guest: boolean, machineId: string): RemoteRole {
  if (!guest) return 'owner';
  return MEMBER_MACHINES.has(machineId) ? 'member' : 'guest';
}

const respondAccessChange = Effect.fn('Sandbox.respondAccessChange')(function* (
  request: Request,
  machineIds: Set<string>,
  add: boolean
) {
  const bearer = readBearerMachine(request);
  const { userId } = yield* parseRequestBody(request, decodeUserBody);
  if (userId !== GUEST.id) return Response.json({ ok: true });
  if (!add) {
    machineIds.delete(bearer);
    return Response.json({ ok: true });
  }
  machineIds.add(bearer);
  const member: RemoteMember = { user: GUEST, addedAt: yield* Clock.currentTimeMillis };
  return Response.json(member);
});

const respondRequester = Effect.fn('Sandbox.respondRequester')(function* (request: Request) {
  const { userId } = yield* parseRequestBody(request, decodeUserBody);
  return Response.json(userId === GUEST.id ? GUEST : USER);
});

const respondAccess = Effect.fn('Sandbox.respondAccess')(function* (
  request: Request,
  pathname: string,
  machines: Machine[],
  user: RemoteUser
) {
  if (pathname === REMOTE_PATHS.machineInvites) return respondInviteCreate(request, machines, INVITES);
  if (pathname === REMOTE_PATHS.inviteAccept)
    return yield* respondInviteAccept(request, machines, user, INVITES, 'invite_invalid');
  if (pathname === REMOTE_PATHS.machineHandoffs) return respondInviteCreate(request, machines, HANDOFFS);
  if (pathname === REMOTE_PATHS.handoffAccept)
    return yield* respondInviteAccept(request, machines, user, HANDOFFS, 'handoff_invalid');
  if (pathname === REMOTE_PATHS.machineGuestAdd)
    return yield* respondAccessChange(request, GUEST_MACHINES, true);
  if (pathname === REMOTE_PATHS.machineGuestRemove)
    return yield* respondAccessChange(request, GUEST_MACHINES, false);
  if (pathname === REMOTE_PATHS.machineRequester) return yield* respondRequester(request);
  if (pathname === REMOTE_PATHS.machineMemberAdd)
    return yield* respondAccessChange(request, MEMBER_MACHINES, true);
  if (pathname === REMOTE_PATHS.machineMemberRemove)
    return yield* respondAccessChange(request, MEMBER_MACHINES, false);
  if (pathname === REMOTE_PATHS.machineInviteRemove || pathname === REMOTE_PATHS.machineHandoffRemove)
    return Response.json({ ok: true });
  return Response.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, { status: 404 });
});

export const respondEnroll = Effect.fn('Sandbox.respondEnroll')(function* (machine: Machine, url: URL) {
  yield* Effect.tryPromise({
    try: () => machine.remote.createLink(),
    catch: (error) =>
      new SandboxFailed({ message: `Making a link to ${machine.name} failed: ${String(error)}` }),
  });
  const { link } = machine.remote.snapshot();
  const target = link?.url ?? REMOTE_PATHS.app;
  return Response.redirect(url.searchParams.has('on') ? target.replace('#', '?on=machine#') : target, 302);
});

export const respondDashboard = Effect.fn('Sandbox.respondDashboard')(function* (
  request: Request,
  url: URL,
  machines: Machine[],
  teammates: Machine[]
) {
  const { pathname } = url;
  const user = readPreviewUser(request);
  if (pathname === `${REMOTE_PATHS.teams}/${TEAM.id}/connect`)
    return yield* respondTeamConnect(request, USER, teammates);
  const owner = MACHINE_OWNERS[readBearerMachine(request)];
  if (owner && pathname === `${REMOTE_PATHS.machineTeams}/${TEAM.id}/connect`)
    return yield* respondTeamConnect(request, owner, teammates);
  if (owner && pathname === `${REMOTE_PATHS.machineTeams}/${TEAM.id}/connect/remote`)
    return yield* respondTeamRemoteConnect(request, owner, teammates);
  const scoped = yield* respondTeamScopes(request, url);
  if (scoped) return scoped;
  const team = respondTeams(request, url);
  if (team) return team;
  const session = respondSession(request, url);
  if (session) return session;
  if (pathname === REMOTE_PATHS.previewOpen) return yield* respondPreviewOpen(url, machines);
  if (pathname === REMOTE_PATHS.instances)
    return Response.json(yield* listInstances(machines, teammates, user));
  if (pathname.startsWith(`${REMOTE_PATHS.pairs}/`)) {
    const [studio] = machines;
    if (pathname.endsWith('/approve')) return Response.json({ instanceId: studio?.id, name: studio?.name });
    return Response.json({
      claimCode: 'K7PQ',
      name: studio?.name ?? 'Studio',
      fingerprint: yield* resolveKeyFingerprint(studio?.publicKey ?? ''),
      expiresAt: (yield* Clock.currentTimeMillis) + 10 * MINUTE,
      claimed: false,
    });
  }
  const machine = teammates.find((entry) => pathname.startsWith(`${REMOTE_PATHS.instances}/${entry.id}/`));
  if (machine && pathname.endsWith('/connect') && request.method === 'POST')
    return yield* respondConnect(machine, user);
  if (machine && (pathname.endsWith('/remove') || pathname.endsWith('/leave'))) return Response.json({});
  return yield* respondAccess(request, pathname, machines, user);
});
