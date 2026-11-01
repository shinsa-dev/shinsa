import type { RemoteSnapshot } from '@shinsa/core';

export function createRemoteSnapshot(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    paired: true,
    enabled: true,
    status: 'connected',
    instanceId: 'k3x9',
    owner: 'mona',
    machineName: 'Studio',
    machineKey: 'machine-key',
    pairing: null,
    devices: [],
    access: null,
    link: null,
    requests: [],
    teams: [],
    ...overrides,
  };
}
