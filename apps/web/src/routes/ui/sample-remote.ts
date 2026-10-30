import type { RemoteSnapshot } from '@shinsa/core';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';

const HOUR_MS = 3_600_000;

export function createSampleRemote(now: number) {
  const connected: RemoteSnapshot = {
    paired: true,
    enabled: true,
    status: 'connected',
    instanceId: 'k3x9',
    owner: 'mona',
    machineName: 'Studio',
    machineKey: 'machine-key',
    pairing: null,
    devices: [
      { publicKey: 'dev-1', name: 'iPhone', enrolledAt: now - 72 * HOUR_MS, lastSeenAt: now - 2 * HOUR_MS },
      { publicKey: 'dev-2', name: 'Work laptop', enrolledAt: now - 5 * HOUR_MS, lastSeenAt: null },
    ],
  };
  return [
    {
      label: 'RemoteAccessGroup · off, ready to turn on',
      snapshot: {
        ...connected,
        paired: false,
        enabled: false,
        status: 'off',
        owner: null,
        instanceId: null,
        devices: [],
      },
    },
    {
      label: 'RemoteAccessGroup · waiting for the GitHub sign-in that pairs this Mac',
      snapshot: {
        ...connected,
        paired: false,
        enabled: false,
        status: 'off',
        owner: null,
        instanceId: null,
        devices: [],
        pairing: {
          claimCode: 'K7PQM2XD',
          url: 'https://app.shinsa.dev/pair?code=K7PQM2XD',
          expiresAt: now + 9 * 60_000,
        },
      },
    },
    { label: 'RemoteAccessGroup · connected, two devices added', snapshot: connected },
    { label: 'RemoteAccessGroup · paired, no devices yet', snapshot: { ...connected, devices: [] } },
    { label: 'RemoteAccessGroup · paused', snapshot: { ...connected, enabled: false, status: 'off' } },
  ] satisfies { label: string; snapshot: RemoteSnapshot }[];
}

export function createSampleRemoteActions(now: number): RemoteAccessActions {
  const answer = () => Promise.reject(new Error('This is a sample. Nothing changes here.'));
  return {
    pair: answer,
    cancelPairing: answer,
    resume: answer,
    pause: answer,
    remove: answer,
    forgetDevice: answer,
    createEnrollment: (name) =>
      Promise.resolve({
        name,
        url: 'https://app.shinsa.dev/enroll#k3x9.BHq2f0pCrDqGkQ4w7sYhJ1nT8vU3mZkL9xRbE6aW5cO.rT3dX8vQ1pLm0sZ7yK4nW2jH',
        expiresAt: now + 10 * 60_000,
      }),
  };
}
