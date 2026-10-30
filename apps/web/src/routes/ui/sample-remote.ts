import type { RemoteInstance, RemoteSnapshot, ShinsaState, WireState } from '@shinsa/core';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';
import { NO_ENTRIES, type ShinsaConnection } from '@/lib/connection/socket.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';

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

const SAMPLE_MACS: RemoteInstance[] = [
  {
    id: 'k3x9',
    name: 'Studio',
    fingerprint: '3f9a 01c2 7b4e 9d10 aa52',
    online: true,
    lastSeenAt: null,
    createdAt: 0,
  },
  {
    id: 'p7m2',
    name: 'MacBook Air',
    fingerprint: '8c21 44de 0f9b 13a7 6e05',
    online: false,
    lastSeenAt: null,
    createdAt: 0,
  },
  {
    id: 'w4t8',
    name: 'Office mini',
    fingerprint: 'b702 5e18 c3d9 4f61 2a8e',
    online: true,
    lastSeenAt: null,
    createdAt: 0,
  },
];

export function createSampleMachineServices(now: number): RemoteServices {
  const refuse = () => Promise.reject(new Error('This is a sample. Nothing changes here.'));
  const macs = SAMPLE_MACS.map((mac) =>
    mac.online ? { ...mac, lastSeenAt: now } : { ...mac, lastSeenAt: now - 26 * HOUR_MS }
  );
  const added = new Set(['k3x9', 'p7m2']);
  return {
    dashboard: {
      readSession: refuse,
      listInstances: () => Promise.resolve(macs),
      requestConnect: refuse,
      removeInstance: refuse,
      readPair: refuse,
      approvePair: refuse,
      signOut: refuse,
    },
    devices: {
      selectDevice: (id) =>
        Promise.resolve(
          added.has(id)
            ? { instanceId: id, machineKey: 'key', keys: {} as CryptoKeyPair, enrolledAt: 0 }
            : null
        ),
      writeDevice: refuse,
      removeDevice: refuse,
    },
    worker: {} as ServiceWorkerContainer,
  };
}

function createStaticConnection(state: ShinsaState): ShinsaConnection {
  const snapshot = { state: state as unknown as WireState, status: 'open' as const };
  const quiet = () => () => undefined;
  const none = () => null;
  return {
    start: () => undefined,
    subscribe: quiet,
    snapshot: () => snapshot,
    subscribeTranscripts: quiet,
    selectTranscript: () => NO_ENTRIES,
    watchTranscript: () => () => undefined,
    subscribeAccounts: quiet,
    selectAccounts: none,
    replaceAccounts: () => undefined,
    subscribeSurfaces: quiet,
    isDesktopConnected: () => false,
    subscribeTerminals: quiet,
    selectTerminals: none,
    replaceTerminals: () => undefined,
    selectMachine: none,
    command: () => Promise.reject(new Error('This is a sample. Nothing changes here.')),
    reset: () => undefined,
    flush: () => undefined,
  };
}

export function createSampleFleet(parts: { name: string; state: ShinsaState }[]) {
  return new Fleet(
    parts.map((part, index) => ({
      id: `mac-${index}`,
      name: part.name,
      connection: createStaticConnection(part.state),
      fetch: () => Promise.reject(new Error('This is a sample. Nothing is sent.')),
    }))
  );
}
