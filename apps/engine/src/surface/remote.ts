import type { RemoteEnrollment, RemoteSnapshot } from '../remote/index.ts';
import type { RemoteDevice } from '../remote/store.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const STATUS_WORDS: Record<RemoteSnapshot['status'], string> = {
  off: 'off',
  starting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  revoked: 'removed from app.shinsa.dev',
};

function describeSeen(at: number | null) {
  return at === null ? 'never used' : `last used ${new Date(at).toISOString()}`;
}

function describeDevice(device: RemoteDevice) {
  return `  ${device.name} (${describeSeen(device.lastSeenAt)}) ${device.publicKey}`;
}

export function formatRemote(snapshot: RemoteSnapshot) {
  if (snapshot.pairing)
    return `Pairing ${snapshot.machineName}: finish signing in at ${snapshot.pairing.url} (code ${snapshot.pairing.claimCode}).`;
  if (!snapshot.paired)
    return 'Remote access is off. Turn it on with `shinsa remote pair` to sign in with GitHub.';
  const lines = [
    `Remote access is ${snapshot.enabled ? STATUS_WORDS[snapshot.status] : 'paused'} for ${snapshot.machineName}, signed in as ${snapshot.owner ?? 'unknown'}.`,
    'Open it at https://app.shinsa.dev.',
  ];
  if (snapshot.devices.length === 0)
    lines.push('No devices are enrolled. Add one with `shinsa remote enroll`.');
  else lines.push('Enrolled devices:', ...snapshot.devices.map(describeDevice));
  return lines.join('\n');
}

function formatEnrollment(enrollment: RemoteEnrollment) {
  return [`Open this link on ${enrollment.name} within 10 minutes. It works once:`, enrollment.url].join(
    '\n'
  );
}

export const REMOTE_SPECS: SurfaceSpec[] = [
  defineRead<RemoteSnapshot>({
    path: ['remote', 'status'],
    summary: 'Show whether this Mac can be reached from app.shinsa.dev, and its enrolled devices.',
    fields: [],
    request: () => '/api/remote',
    format: formatRemote,
  }),
  defineAction({
    path: ['remote', 'pair'],
    summary: 'Turn on remote access: sign in with GitHub in the browser to give this Mac its tunnel.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/pair', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'enable'],
    summary: 'Start the tunnel again after pausing it.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/enable', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'disable'],
    summary: 'Pause remote access: stop the tunnel and close every open session.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/disable', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'remove'],
    summary: 'Remove this Mac from app.shinsa.dev and forget its tunnel and devices.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/remove', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'enroll'],
    summary: 'Make a one-time link that adds a phone or browser to this Mac.',
    humanOnly: true,
    fields: [
      {
        name: 'name',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'What to call the device, such as iPhone.',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<RemoteEnrollment>('/api/remote/devices/enroll', {
        name: readValue(values, 'name'),
      });
      return { data, text: formatEnrollment(data) };
    },
  }),
  defineAction({
    path: ['remote', 'forget-device'],
    summary: 'Remove an enrolled device and close its open sessions.',
    humanOnly: true,
    fields: [
      {
        name: 'device',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The device’s key, from `shinsa remote status`.',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/devices/remove', {
        publicKey: readValue(values, 'device'),
      });
      return { data, text: formatRemote(data) };
    },
  }),
];
