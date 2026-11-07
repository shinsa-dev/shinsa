import {
  ACCESS_SCOPES,
  type AccessRequest,
  type AccessScope,
  DEFAULT_TEAM_SCOPES,
  isTeamKey,
  type MachineCredentials,
  type RemoteAccess,
  type RemoteDevice,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUser,
  type TeamScopeOverride,
} from '@shinsa/core';
import { Predicate } from 'effect';
import { createRemoteFile } from './derive.ts';
import {
  CREDENTIAL_FIELDS,
  type MachineKey,
  type RemoteFileRead,
  type StoredHandoff,
  type StoredLink,
  type RelayDevice,
  type StoredTeamKey,
  type TeamGrant,
  type TeammateExtra,
} from './schema.ts';

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function readMachine(value: unknown): MachineKey | null {
  if (!isFields(value) || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string')
    return null;
  return { publicKey: value.publicKey, privateKey: value.privateKey };
}

function readCredentials(value: unknown): { credentials: MachineCredentials | null; incomplete: boolean } {
  if (!isFields(value)) return { credentials: null, incomplete: false };
  if (!CREDENTIAL_FIELDS.every((field) => typeof value[field] === 'string' && value[field] !== ''))
    return { credentials: null, incomplete: true };
  const fields = value as Record<(typeof CREDENTIAL_FIELDS)[number], string>;
  return {
    credentials: {
      instanceId: fields.instanceId,
      machineToken: fields.machineToken,
      tunnelToken: fields.tunnelToken,
      tunnelHost: fields.tunnelHost,
      connectKey: fields.connectKey,
    },
    incomplete: false,
  };
}

function readDevices(value: unknown): RemoteDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry) || typeof entry.publicKey !== 'string' || typeof entry.name !== 'string') return [];
    if (typeof entry.enrolledAt !== 'number' || typeof entry.userId !== 'string') return [];
    const lastSeenAt = typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null;
    const taskId = typeof entry.taskId === 'string' ? { taskId: entry.taskId } : {};
    const teamId = typeof entry.teamId === 'string' ? { teamId: entry.teamId } : {};
    return [
      {
        publicKey: entry.publicKey,
        name: entry.name,
        enrolledAt: entry.enrolledAt,
        lastSeenAt,
        userId: entry.userId,
        ...taskId,
        ...teamId,
      },
    ];
  });
}

function readOptionalText(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readUser(value: unknown): RemoteUser | null {
  if (!isFields(value) || typeof value.id !== 'string' || typeof value.login !== 'string') return null;
  return {
    id: value.id,
    login: value.login,
    name: readOptionalText(value.name),
    avatarUrl: readOptionalText(value.avatarUrl),
  };
}

function readMembers(value: unknown): RemoteMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const user = isFields(entry) ? readUser(entry.user) : null;
    if (!(user && isFields(entry) && typeof entry.addedAt === 'number')) return [];
    return [{ user, addedAt: entry.addedAt }];
  });
}

function readLink(value: unknown): StoredLink | null {
  if (!isFields(value) || typeof value.secret !== 'string' || typeof value.invite !== 'string') return null;
  if (typeof value.createdAt !== 'number') return null;
  return { secret: value.secret, invite: value.invite, createdAt: value.createdAt };
}

function readHandoffs(value: unknown): StoredHandoff[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const link = readLink(entry);
    if (!(link && isFields(entry) && typeof entry.taskId === 'string')) return [];
    return [{ ...link, taskId: entry.taskId }];
  });
}

export function readGuests(value: unknown) {
  return isFields(value) ? readMembers(value.guests) : [];
}

function readRequests(value: unknown): AccessRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const user = isFields(entry) ? readUser(entry.user) : null;
    if (!(user && isFields(entry))) return [];
    const { id, publicKey, deviceName, requestedAt } = entry;
    if (typeof id !== 'string' || typeof publicKey !== 'string' || typeof deviceName !== 'string') return [];
    if (typeof requestedAt !== 'number') return [];
    return [{ id, publicKey, deviceName, user, requestedAt }];
  });
}

function readTeamMachines(value: unknown): RemoteTeam['machines'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry)) return [];
    const { id, name, userId, online } = entry;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof userId !== 'string') return [];
    const lastSeenAt = typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null;
    const signing = typeof entry.signingKey === 'string' ? { signingKey: entry.signingKey } : {};
    return [{ id, name, userId, online: online === true, lastSeenAt, ...signing }];
  });
}

const SCOPE_NAMES: ReadonlySet<unknown> = new Set(ACCESS_SCOPES);

function readScopes(value: unknown): AccessScope[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((scope): scope is AccessScope => SCOPE_NAMES.has(scope));
}

function readOverrides(value: unknown): TeamScopeOverride[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const scopes = isFields(entry) ? readScopes(entry.scopes) : null;
    if (!(isFields(entry) && typeof entry.userId === 'string' && scopes)) return [];
    return [{ userId: entry.userId, scopes }];
  });
}

function readTeam(value: unknown): RemoteTeam | null {
  const owner = isFields(value) ? readUser(value.owner) : null;
  if (!(owner && isFields(value))) return null;
  const { id, name, role, createdAt } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'number') return null;
  return {
    id,
    name,
    owner,
    role: role === 'owner' ? 'owner' : 'member',
    members: readMembers(value.members),
    requests: readMembers(value.requests),
    machines: readTeamMachines(value.machines),
    scopes: readScopes(value.scopes) ?? DEFAULT_TEAM_SCOPES,
    overrides: readOverrides(value.overrides),
    createdAt,
  };
}

export function readTeams(value: unknown): RemoteTeam[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => readTeam(entry) ?? []);
}

function readTeamKeys(value: unknown): StoredTeamKey[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry)) return [];
    const { teamId, name, key, addedAt } = entry;
    if (typeof teamId !== 'string' || typeof name !== 'string' || typeof addedAt !== 'number') return [];
    if (typeof key !== 'string' || !isTeamKey(key)) return [];
    return [{ teamId, name, key, invite: readOptionalText(entry.invite), addedAt }];
  });
}

function readGrants(value: unknown): TeamGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!(isFields(entry) && typeof entry.userId === 'string' && typeof entry.teamId === 'string')) return [];
    if (typeof entry.secret !== 'string') return [];
    return [{ userId: entry.userId, teamId: entry.teamId, secret: entry.secret }];
  });
}

function readExtras(value: unknown): TeammateExtra[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const scopes = isFields(entry) ? readScopes(entry.scopes) : null;
    if (!(isFields(entry) && typeof entry.userId === 'string' && typeof entry.teamId === 'string' && scopes))
      return [];
    return [{ teamId: entry.teamId, userId: entry.userId, scopes }];
  });
}

const RELAY_DEVICE_TEXTS = ['instanceId', 'teamId', 'machineKey', 'publicKey', 'privateKey'] as const;

function readRelayDevices(value: unknown): RelayDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry) || typeof entry.enrolledAt !== 'number') return [];
    if (!RELAY_DEVICE_TEXTS.every((field) => typeof entry[field] === 'string')) return [];
    const texts = entry as Record<(typeof RELAY_DEVICE_TEXTS)[number], string>;
    return [
      {
        instanceId: texts.instanceId,
        teamId: texts.teamId,
        machineKey: texts.machineKey,
        publicKey: texts.publicKey,
        privateKey: texts.privateKey,
        enrolledAt: entry.enrolledAt,
      },
    ];
  });
}

export function readAccess(value: unknown): RemoteAccess | null {
  const owner = isFields(value) ? readUser(value.owner) : null;
  if (!(owner && isFields(value))) return null;
  return { owner, members: readMembers(value.members) };
}

export function readRemoteFields(fields: Fields | null): RemoteFileRead {
  if (!fields) return { file: createRemoteFile(), credentialsIncomplete: false };
  const { credentials, incomplete } = readCredentials(fields.credentials);
  return {
    file: {
      version: 1,
      machine: readMachine(fields.machine),
      signing: readMachine(fields.signing),
      credentials,
      owner: typeof fields.owner === 'string' ? fields.owner : null,
      enabled: credentials !== null && fields.enabled === true,
      devices: readDevices(fields.devices),
      access: readAccess(fields.access),
      link: readLink(fields.link),
      requests: readRequests(fields.requests),
      guests: readGuests(fields),
      handoffs: readHandoffs(fields.handoffs),
      teams: readTeams(fields.teams) ?? [],
      teamKeys: readTeamKeys(fields.teamKeys),
      grants: readGrants(fields.grants),
      extras: readExtras(fields.extras),
      relayDevices: readRelayDevices(fields.relayDevices),
    },
    credentialsIncomplete: incomplete,
  };
}
