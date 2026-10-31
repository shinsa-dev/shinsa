import { DomainError, type RemoteUser } from '@shinsa/core';
import type { RemoteEnrollment, RemoteSnapshot } from '../remote/index.ts';
import type { RemoteDevice } from '../remote/store.ts';
import type { SurfaceClient } from './client.ts';
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

function describeUser(user: RemoteUser) {
  return user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
}

function describeDevice(snapshot: RemoteSnapshot, device: RemoteDevice) {
  const member = snapshot.access?.members.find((entry) => entry.user.id === device.userId);
  const by = member ? `, added by @${member.user.login}` : '';
  return `  ${device.name} (${describeSeen(device.lastSeenAt)}${by}) ${device.publicKey}`;
}

function describeMembers(snapshot: RemoteSnapshot) {
  const members = snapshot.access?.members ?? [];
  if (members.length === 0) return ['No one else has access. Invite someone with `shinsa remote invite`.'];
  return ['Members:', ...members.map((member) => `  ${describeUser(member.user)}`)];
}

function formatRemote(snapshot: RemoteSnapshot) {
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
  else lines.push('Enrolled devices:', ...snapshot.devices.map((device) => describeDevice(snapshot, device)));
  lines.push(...describeMembers(snapshot));
  return lines.join('\n');
}

function formatEnrollment(enrollment: RemoteEnrollment) {
  const intro =
    enrollment.kind === 'invite'
      ? `Send this link to the person using ${enrollment.name}. They sign in with their own GitHub account within 10 minutes, and it works once:`
      : `Open this link on ${enrollment.name} within 10 minutes, signed in as you. It works once:`;
  return [intro, enrollment.url].join('\n');
}

async function findMemberId(client: SurfaceClient, login: string) {
  const snapshot = await client.read<RemoteSnapshot>('/api/remote');
  const wanted = login.replace(/^@/, '').toLowerCase();
  const member = snapshot.access?.members.find((entry) => entry.user.login.toLowerCase() === wanted);
  if (!member)
    throw new DomainError(
      'member_not_found',
      `@${wanted} has no access to this machine. See its members with \`shinsa remote status\`.`
    );
  return member.user.id;
}

export const REMOTE_SPECS: SurfaceSpec[] = [
  defineRead<RemoteSnapshot>({
    path: ['remote', 'status'],
    summary: 'Show whether this machine can be reached from app.shinsa.dev, and its enrolled devices.',
    fields: [],
    request: () => '/api/remote',
    format: formatRemote,
  }),
  defineAction({
    path: ['remote', 'pair'],
    summary: 'Turn on remote access: sign in with GitHub in the browser to give this machine its tunnel.',
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
    summary: 'Remove this machine from app.shinsa.dev and forget its tunnel and devices.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/remove', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'enroll'],
    summary: 'Make a one-time link that adds a device, a browser or a phone, to this machine.',
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
    path: ['remote', 'invite'],
    summary:
      'Make a one-time link that gives someone else full remote access with their own GitHub account and adds their device.',
    humanOnly: true,
    fields: [
      {
        name: 'name',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'Who or which device the invite is for, such as Bob’s laptop.',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<RemoteEnrollment>('/api/remote/invites', {
        name: readValue(values, 'name'),
      });
      return { data, text: formatEnrollment(data) };
    },
  }),
  defineAction({
    path: ['remote', 'remove-member'],
    summary:
      'Take away someone’s remote access: forget the devices they added and close their open sessions.',
    humanOnly: true,
    fields: [
      {
        name: 'login',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'Their GitHub login, from `shinsa remote status`.',
      },
    ],
    act: async (client, values) => {
      const userId = await findMemberId(client, readValue(values, 'login'));
      const data = await client.post<RemoteSnapshot>('/api/remote/members/remove', { userId });
      return { data, text: formatRemote(data) };
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
