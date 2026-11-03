import {
  type InviteAcceptResponse,
  type InviteCreateResponse,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteMember,
  type RemoteUser,
  resolveKeyFingerprint,
} from '../../packages/core/src/index.ts';
import { MINUTE, DAY } from '../kit/time.ts';
import { createConnect, respondConnect } from './connect.ts';
import { respondPreviewOpen } from './previews.ts';
import { readBearerMachine, readPreviewUser } from './requests.ts';
import { GUEST, type Machine, USER } from './schema.ts';
import { respondSession } from './session.ts';
import { respondTeams } from './team.ts';

const GUEST_MACHINES = new Set<string>();

const INVITES = new Map<string, string>();

const HANDOFFS = new Map<string, string>();

function listInstances(machines: Machine[], user: RemoteUser): Promise<RemoteInstance[]> {
  const now = Date.now();
  const guest = user.id === GUEST.id;
  const listed = guest ? machines.filter((machine) => GUEST_MACHINES.has(machine.id)) : machines;
  return Promise.all(
    listed.map(async (machine) => ({
      id: machine.id,
      name: machine.name,
      fingerprint: await resolveKeyFingerprint(machine.publicKey),
      online: true,
      lastSeenAt: now,
      createdAt: now - 7 * DAY,
      owner: USER,
      role: guest ? 'guest' : 'owner',
    }))
  );
}

function respondInviteCreate(request: Request, machines: Machine[], tokens: Map<string, string>) {
  const bearer = readBearerMachine(request);
  const machine = machines.find((entry) => entry.id === bearer);
  if (!machine) return Response.json({ error: { code: 'revoked', message: 'Not paired.' } }, { status: 401 });
  const token = crypto.randomUUID().replaceAll('-', '');
  tokens.set(token, machine.id);
  const answer: InviteCreateResponse = { token };
  return Response.json(answer);
}

async function respondInviteAccept(
  request: Request,
  machines: Machine[],
  user: RemoteUser,
  tokens: Map<string, string>,
  code: string
) {
  const { token } = (await request.json()) as { token?: string };
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
    connect: await createConnect(machine, user),
  };
  return Response.json(answer);
}

async function respondGuestChange(request: Request, add: boolean) {
  const bearer = readBearerMachine(request);
  const { userId } = (await request.json()) as { userId?: string };
  if (userId !== GUEST.id) return Response.json({ ok: true });
  if (!add) {
    GUEST_MACHINES.delete(bearer);
    return Response.json({ ok: true });
  }
  GUEST_MACHINES.add(bearer);
  const member: RemoteMember = { user: GUEST, addedAt: Date.now() };
  return Response.json(member);
}

async function respondRequester(request: Request) {
  const { userId } = (await request.json()) as { userId?: string };
  return Response.json(userId === GUEST.id ? GUEST : USER);
}

function respondAccess(request: Request, pathname: string, machines: Machine[], user: RemoteUser) {
  if (pathname === REMOTE_PATHS.machineInvites) return respondInviteCreate(request, machines, INVITES);
  if (pathname === REMOTE_PATHS.inviteAccept)
    return respondInviteAccept(request, machines, user, INVITES, 'invite_invalid');
  if (pathname === REMOTE_PATHS.machineHandoffs) return respondInviteCreate(request, machines, HANDOFFS);
  if (pathname === REMOTE_PATHS.handoffAccept)
    return respondInviteAccept(request, machines, user, HANDOFFS, 'handoff_invalid');
  if (pathname === REMOTE_PATHS.machineGuestAdd) return respondGuestChange(request, true);
  if (pathname === REMOTE_PATHS.machineGuestRemove) return respondGuestChange(request, false);
  if (pathname === REMOTE_PATHS.machineRequester) return respondRequester(request);
  if (
    pathname === REMOTE_PATHS.machineInviteRemove ||
    pathname === REMOTE_PATHS.machineMemberRemove ||
    pathname === REMOTE_PATHS.machineHandoffRemove
  )
    return Response.json({ ok: true });
  return Response.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, { status: 404 });
}

export async function respondEnroll(machine: Machine, url: URL) {
  await machine.remote.createLink();
  const { link } = machine.remote.snapshot();
  const target = link?.url ?? REMOTE_PATHS.app;
  return Response.redirect(url.searchParams.has('on') ? target.replace('#', '?on=machine#') : target, 302);
}

export async function respondDashboard(
  request: Request,
  url: URL,
  machines: Machine[],
  teammates: Machine[]
) {
  const { pathname } = url;
  const user = readPreviewUser(request);
  const team = respondTeams(request, url, teammates);
  if (team) return team;
  const session = respondSession(request, url);
  if (session) return session;
  if (pathname === REMOTE_PATHS.previewOpen) return respondPreviewOpen(url, machines);
  if (pathname === REMOTE_PATHS.instances) return Response.json(await listInstances(machines, user));
  if (pathname.startsWith(`${REMOTE_PATHS.pairs}/`)) {
    const [studio] = machines;
    if (pathname.endsWith('/approve')) return Response.json({ instanceId: studio?.id, name: studio?.name });
    return Response.json({
      claimCode: 'K7PQ',
      name: studio?.name ?? 'Studio',
      fingerprint: await resolveKeyFingerprint(studio?.publicKey ?? ''),
      expiresAt: Date.now() + 10 * MINUTE,
      claimed: false,
    });
  }
  const machine = machines.find((entry) => pathname.startsWith(`${REMOTE_PATHS.instances}/${entry.id}/`));
  if (machine && pathname.endsWith('/connect') && request.method === 'POST')
    return respondConnect(machine, user);
  if (machine && (pathname.endsWith('/remove') || pathname.endsWith('/leave'))) return Response.json({});
  return respondAccess(request, pathname, machines, user);
}
