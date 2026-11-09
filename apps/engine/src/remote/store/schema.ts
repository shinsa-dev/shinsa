import type {
  AccessRequest,
  AccessScope,
  MachineCredentials,
  RemoteAccess,
  RemoteDevice,
  RemoteMember,
  RemoteTeam,
} from '@shinsa/core';
import type { Effect } from 'effect';
import type { JsonFileWriteFailed } from '../../files/schema.ts';

export const REMOTE_FILE = 'remote.json';

export const CREDENTIAL_FIELDS = [
  'instanceId',
  'machineToken',
  'tunnelToken',
  'tunnelHost',
  'connectKey',
] as const;

export interface MachineKey {
  publicKey: string;
  privateKey: string;
}

export interface StoredLink {
  secret: string;
  invite: string;
  createdAt: number;
}

export interface StoredHandoff extends StoredLink {
  taskId: string;
}

export interface TeamGrant {
  userId: string;
  teamId: string;
  secret: string;
  joined?: boolean;
}

export interface TeammateExtra {
  teamId: string;
  userId: string;
  scopes: AccessScope[];
}

export interface RelayDevice {
  instanceId: string;
  teamId: string;
  machineKey: string;
  publicKey: string;
  privateKey: string;
  enrolledAt: number;
}

export interface StoredTeamKey {
  teamId: string;
  name: string;
  key: string;
  invite: string | null;
  addedAt: number;
}

export interface RemoteFile {
  version: 1;
  machine: MachineKey | null;
  signing: MachineKey | null;
  credentials: MachineCredentials | null;
  owner: string | null;
  enabled: boolean;
  devices: RemoteDevice[];
  access: RemoteAccess | null;
  link: StoredLink | null;
  requests: AccessRequest[];
  guests: RemoteMember[];
  handoffs: StoredHandoff[];
  teams: RemoteTeam[];
  teamKeys: StoredTeamKey[];
  grants: TeamGrant[];
  extras: TeammateExtra[];
  relayDevices: RelayDevice[];
}

export interface RemoteFileRead {
  readonly file: RemoteFile;
  readonly credentialsIncomplete: boolean;
}

export interface ResolvedKey {
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
}

export interface ParsedKeys {
  readonly machine: CryptoKey | null;
  readonly signing: CryptoKey | null;
}

export interface RemoteStoreHandle {
  readonly file: Effect.Effect<RemoteFile>;
  update(change: (file: RemoteFile) => RemoteFile): Effect.Effect<RemoteFile, JsonFileWriteFailed>;
  readonly resolveMachineKey: Effect.Effect<ResolvedKey, JsonFileWriteFailed>;
  readonly resolveSigningKey: Effect.Effect<ResolvedKey, JsonFileWriteFailed>;
  selectDevice(publicKey: string): Effect.Effect<RemoteDevice | null>;
  upsertDevice(device: RemoteDevice): Effect.Effect<void, JsonFileWriteFailed>;
  removeDevicesOutside(
    userIds: ReadonlySet<string>,
    guestIds: ReadonlySet<string>
  ): Effect.Effect<string[], JsonFileWriteFailed>;
  removeDevicesWhere(match: (device: RemoteDevice) => boolean): Effect.Effect<string[], JsonFileWriteFailed>;
  removeDevice(publicKey: string): Effect.Effect<boolean, JsonFileWriteFailed>;
  recordTeams(teams: RemoteTeam[]): Effect.Effect<boolean, JsonFileWriteFailed>;
  selectTeamKey(teamId: string): Effect.Effect<StoredTeamKey | null>;
  selectTeam(teamId: string): Effect.Effect<RemoteTeam | null>;
  upsertTeamKey(stored: StoredTeamKey): Effect.Effect<void, JsonFileWriteFailed>;
  writeGrant(grant: TeamGrant): Effect.Effect<void, JsonFileWriteFailed>;
  selectGrant(userId: string, teamId: string): Effect.Effect<TeamGrant | null>;
  listGrants(userId: string): Effect.Effect<TeamGrant[]>;
  removeGrantsWhere(match: (grant: TeamGrant) => boolean): Effect.Effect<void, JsonFileWriteFailed>;
  selectExtra(userId: string, teamId: string): Effect.Effect<TeammateExtra | null>;
  writeExtra(extra: TeammateExtra): Effect.Effect<void, JsonFileWriteFailed>;
  removeExtrasWhere(match: (extra: TeammateExtra) => boolean): Effect.Effect<void, JsonFileWriteFailed>;
  selectRelayDevice(instanceId: string): Effect.Effect<RelayDevice | null>;
  writeRelayDevice(device: RelayDevice): Effect.Effect<void, JsonFileWriteFailed>;
  removeRelayDevicesWhere(
    match: (device: RelayDevice) => boolean
  ): Effect.Effect<string[], JsonFileWriteFailed>;
  removeTeam(teamId: string): Effect.Effect<void, JsonFileWriteFailed>;
  recordDeviceSeen(publicKey: string, at: number): Effect.Effect<void, JsonFileWriteFailed>;
}
