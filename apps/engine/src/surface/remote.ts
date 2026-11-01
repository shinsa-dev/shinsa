import { type AccessRequest, DomainError, type RemoteUser } from '@shinsa/core';
import type { RemoteSnapshot } from '../remote/index.ts';
import type { RemoteDevice } from '../remote/store.ts';
import type { SurfaceClient } from './client.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const STATUS_WORDS: Record<RemoteSnapshot['status'], string> = {
  off: 'off',
  starting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  revoked: 'removed from Shinsa Cloud',
};

function describeSeen(at: number | null) {
  return at === null ? 'never used' : `last used ${new Date(at).toISOString()}`;
}

function describeUser(user: RemoteUser) {
  return user.name ? `${user.name} (${user.login})` : user.login;
}

function describeDevice(snapshot: RemoteSnapshot, device: RemoteDevice) {
  const member = snapshot.access?.members.find((entry) => entry.user.id === device.userId);
  const by = member ? `, added by ${describeUser(member.user)}` : '';
  return `  ${device.name} (${describeSeen(device.lastSeenAt)}${by}) ${device.publicKey}`;
}

function describeMembers(snapshot: RemoteSnapshot) {
  const members = snapshot.access?.members ?? [];
  if (members.length === 0)
    return ['No one else has access. Share the link from `shinsa remote link` to let someone ask.'];
  return ['Members:', ...members.map((member) => `  ${describeUser(member.user)}`)];
}

function formatRemote(snapshot: RemoteSnapshot) {
  if (snapshot.pairing)
    return `Pairing ${snapshot.machineName}: finish signing in at ${snapshot.pairing.url} (code ${snapshot.pairing.claimCode}).`;
  if (!snapshot.paired)
    return 'Remote access is off. Turn it on with `shinsa remote pair` to sign in with GitHub.';
  const lines = [
    `Remote access is ${snapshot.enabled ? STATUS_WORDS[snapshot.status] : 'paused'} for ${snapshot.machineName}, signed in as ${snapshot.owner ?? 'unknown'}.`,
    'Open it in Shinsa Cloud at https://app.shinsa.dev.',
  ];
  if (snapshot.devices.length === 0)
    lines.push('No devices are added. Make a link with `shinsa remote link`.');
  else lines.push('Added devices:', ...snapshot.devices.map((device) => describeDevice(snapshot, device)));
  lines.push(...describeMembers(snapshot), ...describeLinks(snapshot), ...describeRequests(snapshot));
  return lines.join('\n');
}

function describeLinks(snapshot: RemoteSnapshot) {
  return snapshot.link ? [`Invite link: ${snapshot.link.url}`] : [];
}

function describeRequest(request: AccessRequest) {
  return `  ${request.id} ${describeUser(request.user)} asks to add ${request.deviceName}`;
}

function describeRequests(snapshot: RemoteSnapshot) {
  if (snapshot.requests.length === 0) return [];
  return [
    'Access requests (accept or decline each with `shinsa remote accept` or `shinsa remote decline`):',
    ...snapshot.requests.map(describeRequest),
  ];
}

function formatLink(snapshot: RemoteSnapshot) {
  return [
    'Open this link on your own device, or share it. Whoever opens it signs in with GitHub and asks for access, which you accept or decline:',
    snapshot.link?.url ?? 'No link was made.',
  ].join('\n');
}

async function findRequestId(client: SurfaceClient, ref: string) {
  const snapshot = await client.read<RemoteSnapshot>('/api/remote');
  const wanted = ref.replace(/^@/, '').toLowerCase();
  const matches = snapshot.requests.filter(
    (entry) => entry.id === ref || entry.user.login.toLowerCase() === wanted
  );
  const [found] = matches;
  if (found && matches.length === 1) return found.id;
  const problem =
    matches.length > 1
      ? `${wanted} asked more than once; name the request by its id`
      : `No access request matches ${ref}`;
  throw new DomainError('request_not_found', `${problem}. See them with \`shinsa remote status\`.`);
}

const REQUEST_FIELD = {
  name: 'request',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The request’s id, or the GitHub login that asked, from `shinsa remote status`.',
} as const;

async function findMemberId(client: SurfaceClient, login: string) {
  const snapshot = await client.read<RemoteSnapshot>('/api/remote');
  const wanted = login.replace(/^@/, '').toLowerCase();
  const member = snapshot.access?.members.find((entry) => entry.user.login.toLowerCase() === wanted);
  if (!member)
    throw new DomainError(
      'member_not_found',
      `${wanted} has no access to this machine. See its members with \`shinsa remote status\`.`
    );
  return member.user.id;
}

export const REMOTE_SPECS: SurfaceSpec[] = [
  defineRead<RemoteSnapshot>({
    path: ['remote', 'status'],
    summary: 'Show whether this machine can be reached from Shinsa Cloud, and its enrolled devices.',
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
    summary: 'Remove this machine from Shinsa Cloud and forget its tunnel and devices.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/remove', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'link'],
    summary: 'Show the reusable invite link that asks for access to this machine, making it if it is off.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/link/create', {});
      return { data, text: formatLink(data) };
    },
  }),
  defineAction({
    path: ['remote', 'link-off'],
    summary: 'Turn the invite link off, so nobody can ask for access with it any more.',
    humanOnly: true,
    fields: [],
    act: async (client) => {
      const data = await client.post<RemoteSnapshot>('/api/remote/link/remove', {});
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'accept'],
    summary: 'Accept an access request: add its device, and make its account a member when it is not yours.',
    humanOnly: true,
    fields: [REQUEST_FIELD],
    act: async (client, values) => {
      const requestId = await findRequestId(client, readValue(values, 'request'));
      const data = await client.post<RemoteSnapshot>('/api/remote/requests/accept', { requestId });
      return { data, text: formatRemote(data) };
    },
  }),
  defineAction({
    path: ['remote', 'decline'],
    summary: 'Decline an access request and forget it.',
    humanOnly: true,
    fields: [REQUEST_FIELD],
    act: async (client, values) => {
      const requestId = await findRequestId(client, readValue(values, 'request'));
      const data = await client.post<RemoteSnapshot>('/api/remote/requests/decline', { requestId });
      return { data, text: formatRemote(data) };
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
