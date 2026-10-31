import type { RemoteAccess, RemoteUser } from './contract.ts';

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

export type LinkKind = 'device' | 'invite';

export interface RemoteLink {
  kind: LinkKind;
  url: string;
  createdAt: number;
}

export interface AccessRequest {
  id: string;
  kind: LinkKind;
  publicKey: string;
  deviceName: string;
  user: RemoteUser;
  requestedAt: number;
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
  links: RemoteLink[];
  requests: AccessRequest[];
}
