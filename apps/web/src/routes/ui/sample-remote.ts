import {
  DEVELOPMENT_VERSION,
  NO_TEAM_FEED,
  type RemoteInstance,
  type RemoteSnapshot,
  resolveEngineInfo,
  type ShinsaState,
  type WireState,
} from '@shinsa/core';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';
import {
  NO_ENTRIES,
  NO_MACHINE_ACCESS,
  NO_MACHINES,
  NO_UNREACHABLE_MACHINES,
  type ShinsaConnection,
} from '@/lib/connection/socket.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';

const HOUR_MS = 3_600_000;

const SAMPLE_OWNER = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const SAMPLE_MEMBER = { id: '2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

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
      {
        publicKey: 'dev-1',
        name: 'iPhone',
        enrolledAt: now - 72 * HOUR_MS,
        lastSeenAt: now - 2 * HOUR_MS,
        userId: null,
      },
      {
        publicKey: 'dev-2',
        name: 'Work laptop',
        enrolledAt: now - 5 * HOUR_MS,
        lastSeenAt: null,
        userId: null,
      },
      {
        publicKey: 'dev-3',
        name: 'Kai’s laptop',
        enrolledAt: now - 30 * HOUR_MS,
        lastSeenAt: now - 20 * 60_000,
        userId: SAMPLE_MEMBER.id,
      },
    ],
    access: { owner: SAMPLE_OWNER, members: [{ user: SAMPLE_MEMBER, addedAt: now - 30 * HOUR_MS }] },
    link: {
      url: 'https://app.shinsa.dev/enroll#k3x9.BHq2f0pCrDqGkQ4w7sYhJ1nT8vU3mZkL9xRbE6aW5cO.rT3dX8vQ1pLm0sZ7yK4nW2jH.Qm9iLWludml0ZS10b2tlbg',
      createdAt: now - 26 * HOUR_MS,
    },
    requests: [
      {
        id: 'request-1',
        publicKey: 'dev-4',
        deviceName: 'Bob iPhone',
        user: { id: '4', login: 'bob', name: 'Bob Stone', avatarUrl: null },
        requestedAt: now - 4 * 60_000,
      },
      {
        id: 'request-2',
        publicKey: 'dev-5',
        deviceName: 'Safari on iPad',
        user: SAMPLE_OWNER,
        requestedAt: now - 60_000,
      },
    ],
    teams: [],
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
      label: 'RemoteAccessGroup · waiting for the GitHub sign-in that pairs this machine',
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
    {
      label: 'RemoteAccessGroup · connected, two requests waiting, three devices and one member',
      snapshot: connected,
    },
    {
      label: 'RemoteAccessGroup · paired, no devices, members, links or requests yet',
      snapshot: {
        ...connected,
        devices: [],
        access: { owner: SAMPLE_OWNER, members: [] },
        link: null,
        requests: [],
      },
    },
    { label: 'RemoteAccessGroup · paused', snapshot: { ...connected, enabled: false, status: 'off' } },
  ] satisfies { label: string; snapshot: RemoteSnapshot }[];
}

export function createSampleRemoteActions(): RemoteAccessActions {
  const answer = () => Promise.reject(new Error('This is a sample. Nothing changes here.'));
  return {
    pair: answer,
    cancelPairing: answer,
    resume: answer,
    pause: answer,
    remove: answer,
    revokeDevice: answer,
    removeMember: answer,
    createLink: answer,
    removeLink: answer,
    acceptRequest: answer,
    declineRequest: answer,
  };
}

const SAMPLE_PARTNER = { id: '3', login: 'lee', name: 'Lee Park', avatarUrl: null };

export const SAMPLE_MACS: RemoteInstance[] = [
  {
    id: 'k3x9',
    name: 'Studio',
    fingerprint: '3f9a 01c2 7b4e 9d10 aa52',
    online: true,
    lastSeenAt: null,
    createdAt: 0,
    owner: SAMPLE_OWNER,
    role: 'owner',
  },
  {
    id: 'p7m2',
    name: 'MacBook Air',
    fingerprint: '8c21 44de 0f9b 13a7 6e05',
    online: false,
    lastSeenAt: null,
    createdAt: 0,
    owner: SAMPLE_OWNER,
    role: 'owner',
  },
  {
    id: 'w4t8',
    name: 'Office mini',
    fingerprint: 'b702 5e18 c3d9 4f61 2a8e',
    online: true,
    lastSeenAt: null,
    createdAt: 0,
    owner: SAMPLE_OWNER,
    role: 'owner',
  },
  {
    id: 'v9q1',
    name: 'Team server',
    fingerprint: '51ce 9a07 e3b4 28df 0c6a',
    online: true,
    lastSeenAt: null,
    createdAt: 0,
    owner: SAMPLE_PARTNER,
    role: 'member',
  },
];

export function createSampleMachineServices(now: number): RemoteServices {
  const refuse = () => Promise.reject(new Error('This is a sample. Nothing changes here.'));
  const macs = SAMPLE_MACS.map((mac) =>
    mac.online ? { ...mac, lastSeenAt: now } : { ...mac, lastSeenAt: now - 26 * HOUR_MS }
  );
  const added = new Set(['k3x9', 'p7m2', 'v9q1']);
  return {
    dashboard: {
      readSession: refuse,
      listInstances: () => Promise.resolve(macs),
      requestConnect: refuse,
      removeInstance: refuse,
      leaveInstance: refuse,
      acceptInvite: refuse,
      listTeams: () => Promise.resolve([]),
      joinTeam: refuse,
      previewTeam: refuse,
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
      listWaitingDevices: () => Promise.resolve([]),
      writeDevice: refuse,
      removeDevice: refuse,
    },
    teamKeys: { selectTeamKey: () => Promise.resolve(null), writeTeamKey: refuse },
    worker: {} as ServiceWorkerContainer,
  };
}

const SAMPLE_ENGINE = resolveEngineInfo(DEVELOPMENT_VERSION);

export function createStaticConnection(state: ShinsaState): ShinsaConnection {
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
    subscribeRemote: quiet,
    selectRemote: none,
    replaceRemote: () => undefined,
    subscribeTeams: quiet,
    selectTeams: () => NO_TEAM_FEED,
    selectMachine: none,
    listMachines: () => NO_MACHINES,
    listUnreachableMachines: () => NO_UNREACHABLE_MACHINES,
    listMachineAccess: () => NO_MACHINE_ACCESS,
    selectEngine: () => SAMPLE_ENGINE,
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
