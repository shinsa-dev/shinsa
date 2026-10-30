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
}

export interface RemoteEnrollment {
  url: string;
  name: string;
  expiresAt: number;
}
