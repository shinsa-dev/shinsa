import { existsSync, readFileSync } from 'node:fs';
import type { AccessRequest, RemoteDevice, RemoteTeamEntry } from '@shinsa/core';
import {
  isTeamKey,
  type MachineCredentials,
  parsePrivateKey,
  REMOTE_KEY_ALGORITHM,
  type RemoteAccess,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUser,
  serializePrivateKey,
  serializePublicKey,
} from '@shinsa/core';
import { writeJsonFile } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';

export const REMOTE_FILE = 'remote.json';

export type { RemoteDevice } from '@shinsa/core';

interface MachineKey {
  publicKey: string;
  privateKey: string;
}

export interface RemoteFile {
  version: 1;
  machine: MachineKey | null;
  credentials: MachineCredentials | null;
  owner: string | null;
  enabled: boolean;
  devices: RemoteDevice[];
  access: RemoteAccess | null;
  link: StoredLink | null;
  requests: AccessRequest[];
  teams: RemoteTeam[];
  teamKeys: StoredTeamKey[];
}

export interface StoredTeamKey {
  teamId: string;
  name: string;
  key: string;
  invite: string | null;
  addedAt: number;
}

export interface StoredLink {
  secret: string;
  invite: string;
  createdAt: number;
}

type Fields = Record<string, unknown>;

const CREDENTIAL_FIELDS = ['instanceId', 'machineToken', 'tunnelToken', 'tunnelHost', 'connectKey'] as const;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMachine(value: unknown): MachineKey | null {
  if (!isFields(value) || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string')
    return null;
  return { publicKey: value.publicKey, privateKey: value.privateKey };
}

function readCredentials(value: unknown): MachineCredentials | null {
  if (!isFields(value)) return null;
  if (!CREDENTIAL_FIELDS.every((field) => typeof value[field] === 'string' && value[field] !== '')) {
    log.warn('[Remote] remote.json is missing part of its credentials; pair this machine again');
    return null;
  }
  const fields = value as Record<(typeof CREDENTIAL_FIELDS)[number], string>;
  return {
    instanceId: fields.instanceId,
    machineToken: fields.machineToken,
    tunnelToken: fields.tunnelToken,
    tunnelHost: fields.tunnelHost,
    connectKey: fields.connectKey,
  };
}

function readDevices(value: unknown): RemoteDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry) || typeof entry.publicKey !== 'string' || typeof entry.name !== 'string') return [];
    if (typeof entry.enrolledAt !== 'number') return [];
    const lastSeenAt = typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null;
    const userId = typeof entry.userId === 'string' ? entry.userId : null;
    return [
      {
        publicKey: entry.publicKey,
        name: entry.name,
        enrolledAt: entry.enrolledAt,
        lastSeenAt,
        userId,
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
    return [{ id, name, userId, online: online === true, lastSeenAt }];
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

export function listTeamEntries(file: RemoteFile): RemoteTeamEntry[] {
  const keys = new Map(file.teamKeys.map((stored) => [stored.teamId, stored]));
  const known = file.teams.map((team) => ({
    id: team.id,
    name: team.name,
    status: 'member' as const,
    onMachine: keys.has(team.id),
    invite: team.role === 'owner' && Boolean(keys.get(team.id)?.invite),
    team,
  }));
  const asked = file.teamKeys
    .filter((stored) => !file.teams.some((team) => team.id === stored.teamId))
    .map((stored) => ({
      id: stored.teamId,
      name: stored.name,
      status: 'requested' as const,
      onMachine: true,
      invite: false,
      team: null,
    }));
  return [...known, ...asked];
}

export function readAccess(value: unknown): RemoteAccess | null {
  const owner = isFields(value) ? readUser(value.owner) : null;
  if (!(owner && isFields(value))) return null;
  return { owner, members: readMembers(value.members) };
}

function createRemoteFile(): RemoteFile {
  return {
    version: 1,
    machine: null,
    credentials: null,
    owner: null,
    enabled: false,
    devices: [],
    access: null,
    link: null,
    requests: [],
    teams: [],
    teamKeys: [],
  };
}

export function readRemoteFile(path: string): RemoteFile {
  if (!existsSync(path)) return createRemoteFile();
  let fields: unknown;
  try {
    fields = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    log.warn('[Remote] remote.json could not be read; remote access is off', { error: describeError(error) });
    return createRemoteFile();
  }
  if (!isFields(fields)) return createRemoteFile();
  const credentials = readCredentials(fields.credentials);
  return {
    version: 1,
    machine: readMachine(fields.machine),
    credentials,
    owner: typeof fields.owner === 'string' ? fields.owner : null,
    enabled: credentials !== null && fields.enabled === true,
    devices: readDevices(fields.devices),
    access: readAccess(fields.access),
    link: readLink(fields.link),
    requests: readRequests(fields.requests),
    teams: readTeams(fields.teams) ?? [],
    teamKeys: readTeamKeys(fields.teamKeys),
  };
}

export class RemoteStore {
  readonly path: string;
  #file: RemoteFile;
  #machineKey: CryptoKey | null = null;

  constructor(path: string) {
    this.path = path;
    this.#file = readRemoteFile(path);
  }

  get file(): RemoteFile {
    return this.#file;
  }

  update(change: (file: RemoteFile) => RemoteFile) {
    this.#file = change(this.#file);
    writeJsonFile(this.path, this.#file);
    return this.#file;
  }

  async resolveMachineKey() {
    const stored = this.#file.machine;
    const parsed = stored && (this.#machineKey ?? (await parsePrivateKey(stored.privateKey)));
    if (stored && parsed) {
      this.#machineKey = parsed;
      return { publicKey: stored.publicKey, privateKey: parsed };
    }
    const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const machine = {
      publicKey: await serializePublicKey(pair.publicKey),
      privateKey: await serializePrivateKey(pair.privateKey),
    };
    this.update((file) => ({ ...file, machine }));
    this.#machineKey = (await parsePrivateKey(machine.privateKey)) as CryptoKey;
    return { publicKey: machine.publicKey, privateKey: this.#machineKey };
  }

  selectDevice(publicKey: string) {
    return this.#file.devices.find((device) => device.publicKey === publicKey) ?? null;
  }

  upsertDevice(device: RemoteDevice) {
    this.update((file) => ({
      ...file,
      devices: [...file.devices.filter((entry) => entry.publicKey !== device.publicKey), device],
    }));
  }

  removeDevicesOutside(userIds: ReadonlySet<string>) {
    const removed = this.#file.devices.filter(
      (device) => device.userId !== null && !userIds.has(device.userId)
    );
    if (removed.length === 0) return [];
    this.update((file) => ({
      ...file,
      devices: file.devices.filter((device) => !removed.includes(device)),
    }));
    return removed.map((device) => device.publicKey);
  }

  removeDevice(publicKey: string) {
    const before = this.#file.devices.length;
    this.update((file) => ({
      ...file,
      devices: file.devices.filter((device) => device.publicKey !== publicKey),
    }));
    return this.#file.devices.length < before;
  }

  recordTeams(teams: RemoteTeam[]) {
    const before = this.#file.teams;
    const kept = this.#file.teamKeys.flatMap((stored) => {
      const team = teams.find((entry) => entry.id === stored.teamId);
      if (team) return [{ ...stored, name: team.name }];
      return before.some((entry) => entry.id === stored.teamId) ? [] : [stored];
    });
    const changed =
      JSON.stringify(teams) !== JSON.stringify(before) ||
      JSON.stringify(kept) !== JSON.stringify(this.#file.teamKeys);
    if (changed) this.update((file) => ({ ...file, teams, teamKeys: kept }));
    return changed;
  }

  selectTeamKey(teamId: string) {
    return this.#file.teamKeys.find((stored) => stored.teamId === teamId) ?? null;
  }

  selectTeam(teamId: string) {
    return this.#file.teams.find((team) => team.id === teamId) ?? null;
  }

  upsertTeamKey(stored: StoredTeamKey) {
    this.update((file) => ({
      ...file,
      teamKeys: [...file.teamKeys.filter((entry) => entry.teamId !== stored.teamId), stored],
    }));
  }

  removeTeam(teamId: string) {
    this.update((file) => ({
      ...file,
      teams: file.teams.filter((team) => team.id !== teamId),
      teamKeys: file.teamKeys.filter((stored) => stored.teamId !== teamId),
    }));
  }

  recordDeviceSeen(publicKey: string, at: number) {
    if (!this.selectDevice(publicKey)) return;
    this.update((file) => ({
      ...file,
      devices: file.devices.map((device) =>
        device.publicKey === publicKey ? { ...device, lastSeenAt: at } : device
      ),
    }));
  }
}
