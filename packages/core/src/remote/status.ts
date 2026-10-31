import type { RemoteAccess } from './contract.ts';

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
  enrollmentId: string | null;
  userId: string | null;
}

export type EnrollmentKind = 'device' | 'invite';

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
}

export interface RemoteEnrollment {
  id: string;
  kind: EnrollmentKind;
  url: string;
  name: string;
  expiresAt: number;
}
