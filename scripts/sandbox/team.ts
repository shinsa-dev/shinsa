import type { ServerWebSocket } from 'bun';
import {
  ACCESS_PRESETS,
  DEFAULT_TEAM_SCOPES,
  REMOTE_PATHS,
  type RemoteTeam,
  type RemoteUser,
  type TeamJoinResponse,
  type TeamScopesRequest,
  toggleScope,
  type TeamPreviewResponse,
} from '../../packages/core/src/index.ts';
import { DAY, HOUR } from '../kit/time.ts';
import { respondTeamConnect } from './connect.ts';
import { createRandomKey, readBearerMachine } from './requests.ts';
import { TEAM_INVITE, TEAMMATE, type Machine, type TunnelData, USER } from './schema.ts';

export const TEAM_KEY = createRandomKey(32);

export const MACHINE_OWNERS: Record<string, RemoteUser> = { studio: USER, laptop: USER, kai: TEAMMATE };

export const TEAM: Omit<RemoteTeam, 'role'> = {
  id: 'core',
  name: 'Product team',
  owner: USER,
  members: [{ user: TEAMMATE, addedAt: Date.now() - 3 * DAY }],
  requests: [
    {
      user: { id: '3', login: 'ines', name: 'Inês Costa', avatarUrl: null },
      addedAt: Date.now() - HOUR,
    },
  ],
  machines: [
    { id: 'studio', name: 'Studio', userId: USER.id, online: true, lastSeenAt: Date.now() },
    { id: 'laptop', name: 'Laptop', userId: USER.id, online: true, lastSeenAt: Date.now() },
    { id: 'kai', name: 'Kai’s MacBook', userId: TEAMMATE.id, online: true, lastSeenAt: Date.now() },
  ],
  scopes: DEFAULT_TEAM_SCOPES,
  overrides: [{ userId: TEAMMATE.id, scopes: ACCESS_PRESETS.full }],
  createdAt: Date.now() - 7 * DAY,
};

const DESIGN_PEOPLE: RemoteUser[] = [
  { id: '21', login: 'ines', name: 'Inês Costa', avatarUrl: null },
  { id: '22', login: 'theo', name: 'Theo Park', avatarUrl: null },
  { id: '23', login: 'amara', name: 'Amara Obi', avatarUrl: null },
  { id: '24', login: 'jonas', name: 'Jonas Weber', avatarUrl: null },
  { id: '25', login: 'lea', name: 'Léa Martin', avatarUrl: null },
  { id: '26', login: 'sam', name: null, avatarUrl: null },
  { id: '27', login: 'priya', name: 'Priya Nair', avatarUrl: null },
];

const OTHER_TEAMS: Omit<RemoteTeam, 'role'>[] = [
  {
    id: 'design',
    name: 'Design systems',
    owner: TEAMMATE,
    members: [USER, ...DESIGN_PEOPLE].map((user, index) => ({
      user,
      addedAt: Date.now() - (index + 1) * DAY,
    })),
    requests: [],
    machines: [{ id: 'kai', name: 'Kai’s MacBook', userId: TEAMMATE.id, online: false, lastSeenAt: null }],
    scopes: toggleScope(DEFAULT_TEAM_SCOPES, 'services', false),
    overrides: [],
    createdAt: Date.now() - 30 * DAY,
  },
  {
    id: 'platform',
    name: 'Platform',
    owner: USER,
    members: [],
    requests: [],
    machines: TEAM.machines.filter((machine) => machine.userId === USER.id),
    scopes: DEFAULT_TEAM_SCOPES,
    overrides: [],
    createdAt: Date.now() - DAY,
  },
];

const TEAM_SCOPES_PATH = new RegExp(`^${REMOTE_PATHS.machineTeams}/([^/]+)/scopes$`);

const REQUESTED_TEAM = { id: 'growth', name: 'Growth' };

const PREVIEW_TEAM_KEYS: Record<string, string> = Object.fromEntries(
  [...OTHER_TEAMS, REQUESTED_TEAM].map((team) => [team.id, createRandomKey(32)])
);

const TEAM_SCOPES = new Map<string, Pick<RemoteTeam, 'scopes' | 'overrides'>>(
  [TEAM, ...OTHER_TEAMS].map((team) => [team.id, { scopes: team.scopes, overrides: team.overrides }])
);

async function respondScopesChange(request: Request, teamId: string) {
  const current = TEAM_SCOPES.get(teamId);
  if (!current)
    return Response.json({ error: { code: 'not_found', message: 'No such team.' } }, { status: 404 });
  const { userId, scopes } = (await request.json()) as TeamScopesRequest;
  if (!userId) {
    TEAM_SCOPES.set(teamId, { ...current, scopes: scopes ?? DEFAULT_TEAM_SCOPES });
    return Response.json({ ok: true });
  }
  const others = current.overrides.filter((entry) => entry.userId !== userId);
  const overrides = scopes ? [...others, { userId, scopes }] : others;
  TEAM_SCOPES.set(teamId, { ...current, overrides });
  return Response.json({ ok: true });
}

export const teammateLink = {
  online: true,
  signingKey: null as string | null,
  sockets: new Set<ServerWebSocket<TunnelData>>(),
};

function isInTeam(team: Omit<RemoteTeam, 'role'>, user: RemoteUser) {
  return team.owner.id === user.id || team.members.some((member) => member.user.id === user.id);
}

export function resolvePreviewTeams(owner: RemoteUser): RemoteTeam[] {
  return [TEAM, ...OTHER_TEAMS]
    .filter((team) => isInTeam(team, owner))
    .map((team) => {
      const role = owner.id === team.owner.id ? 'owner' : 'member';
      const machines = team.machines.map((machine) =>
        machine.userId === TEAMMATE.id && team.id === TEAM.id
          ? {
              ...machine,
              online: teammateLink.online,
              ...(teammateLink.signingKey ? { signingKey: teammateLink.signingKey } : {}),
            }
          : machine
      );
      const access = TEAM_SCOPES.get(team.id) ?? team;
      return { ...team, ...access, role, machines, requests: role === 'owner' ? team.requests : [] };
    });
}

export function toggleTeammate(url: URL) {
  teammateLink.online = url.pathname.endsWith('/online');
  if (!teammateLink.online) for (const socket of [...teammateLink.sockets]) socket.close(1001, 'Offline');
  return new Response(`Kai’s MacBook is ${teammateLink.online ? 'online' : 'offline'}.`);
}

export function listPreviewTeamKeys(owner: RemoteUser) {
  const keys = resolvePreviewTeams(owner).map((team) => ({
    teamId: team.id,
    name: team.name,
    key: PREVIEW_TEAM_KEYS[team.id] ?? TEAM_KEY,
    invite: team.role !== 'owner' ? null : team.id === TEAM.id ? TEAM_INVITE : `${TEAM_INVITE}-${team.id}`,
    addedAt: team.createdAt,
  }));
  if (owner.id !== USER.id) return keys;
  return [
    ...keys,
    {
      teamId: REQUESTED_TEAM.id,
      name: REQUESTED_TEAM.name,
      key: PREVIEW_TEAM_KEYS[REQUESTED_TEAM.id] ?? TEAM_KEY,
      invite: null,
      addedAt: Date.now() - 2 * HOUR,
    },
  ];
}

export function respondTeams(request: Request, url: URL, teammates: Machine[]) {
  const { pathname } = url;
  if (pathname === REMOTE_PATHS.teams) return Response.json(resolvePreviewTeams(USER));
  if (pathname === REMOTE_PATHS.teamJoin) {
    const answer: TeamJoinResponse = {
      teamId: TEAM.id,
      name: TEAM.name,
      owner: TEAM.owner,
      status: 'member',
    };
    return Response.json(answer);
  }
  if (pathname === REMOTE_PATHS.teamPreview) {
    const answer: TeamPreviewResponse = { name: TEAM.name, owner: TEAM.owner };
    return Response.json(answer);
  }
  if (pathname === `${REMOTE_PATHS.teams}/${TEAM.id}/connect`)
    return respondTeamConnect(request, USER, teammates);
  const owner = MACHINE_OWNERS[readBearerMachine(request)] ?? null;
  if (owner && pathname === `${REMOTE_PATHS.machineTeams}/${TEAM.id}/connect`)
    return respondTeamConnect(request, owner, teammates);
  const scopes = TEAM_SCOPES_PATH.exec(pathname);
  if (owner && scopes) return respondScopesChange(request, scopes[1] ?? '');
  if (owner && pathname.startsWith(`${REMOTE_PATHS.machineTeams}/`)) return Response.json({ ok: true });
  return null;
}
