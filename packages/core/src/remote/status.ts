import type { RemoteAccess, RemoteUser } from './contract.ts';
import type { RemoteTeam } from './teams.ts';

export type TunnelStatus = 'off' | 'starting' | 'connected' | 'reconnecting' | 'revoked';

export interface PairingView {
  claimCode: string;
  url: string;
  expiresAt: number;
}

export interface RemoteDevice {
  publicKey: string;
  name: string;
  enrolledAt: number;
  lastSeenAt: number | null;
  userId: string | null;
}

export interface RemoteLink {
  url: string;
  createdAt: number;
}

export interface AccessRequest {
  id: string;
  publicKey: string;
  deviceName: string;
  user: RemoteUser;
  requestedAt: number;
}

export type TeamStatus = 'member' | 'requested';

export interface RemoteTeamEntry {
  id: string;
  name: string;
  status: TeamStatus;
  onMachine: boolean;
  invite: boolean;
  team: RemoteTeam | null;
}

export interface RemoteSnapshot {
  paired: boolean;
  enabled: boolean;
  status: TunnelStatus;
  instanceId: string | null;
  owner: string | null;
  machineName: string;
  machineKey: string | null;
  pairing: PairingView | null;
  devices: RemoteDevice[];
  access: RemoteAccess | null;
  link: RemoteLink | null;
  requests: AccessRequest[];
  teams: RemoteTeamEntry[];
}
