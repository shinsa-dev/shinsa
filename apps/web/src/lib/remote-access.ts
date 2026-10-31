import type {
  AccessRequest,
  LinkKind,
  RemoteAccess,
  RemoteDevice,
  RemoteLink,
  RemoteMember,
  RemoteSnapshot,
} from '@shinsa/core';
import { encode } from 'uqr';
import { formatSince, formatUntil } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { selectDeviceMember } from '@/lib/remote/users.ts';

export const REMOTE_ACCESS_SECTION = 'Remote access';

export interface RemoteStatusView {
  label: string;
  tone: Tone;
  detail: string;
}

const STATUS_VIEW: Record<RemoteSnapshot['status'], Omit<RemoteStatusView, 'detail'>> = {
  off: { label: 'Off', tone: 'neutral' },
  starting: { label: 'Connecting', tone: 'amber' },
  connected: { label: 'Connected', tone: 'green' },
  reconnecting: { label: 'Reconnecting', tone: 'amber' },
  revoked: { label: 'Removed', tone: 'red' },
};

export function describeRemoteStatus(snapshot: RemoteSnapshot, now = Date.now()): RemoteStatusView {
  if (snapshot.pairing)
    return {
      label: 'Waiting for sign-in',
      tone: 'amber',
      detail: `Sign in with GitHub and approve code ${snapshot.pairing.claimCode}. ${formatUntil('The code expires', snapshot.pairing.expiresAt, now)}.`,
    };
  if (!snapshot.paired)
    return {
      label: 'Off',
      tone: 'neutral',
      detail: 'Turn it on to sign in with GitHub. This machine then shows up in Shinsa Cloud.',
    };
  const owner = snapshot.owner ? `Signed in as ${snapshot.owner}.` : 'Signed in.';
  if (snapshot.status === 'revoked')
    return {
      ...STATUS_VIEW.revoked,
      detail: 'This machine was removed in Shinsa Cloud. Remove it here, then turn remote access on again.',
    };
  if (!snapshot.enabled)
    return { label: 'Paused', tone: 'neutral', detail: `${owner} Resume to reach this machine again.` };
  return { ...STATUS_VIEW[snapshot.status], detail: `${owner} Open it in Shinsa Cloud.` };
}

export function describeDeviceSeen(device: RemoteDevice, now = Date.now()) {
  if (device.lastSeenAt === null) return formatSince('Added', device.enrolledAt, now);
  return formatSince('Last used', device.lastSeenAt, now);
}

export function describeDeviceDetail(device: RemoteDevice, access: RemoteAccess | null, now = Date.now()) {
  const member = selectDeviceMember(access, device);
  const seen = describeDeviceSeen(device, now);
  return member ? `${seen} · Added by @${member.login}` : seen;
}

export function describeMemberSince(member: RemoteMember, now = Date.now()) {
  return formatSince('Joined', member.addedAt, now);
}

export function canEnrollDevices(snapshot: RemoteSnapshot | null) {
  return snapshot?.paired === true && snapshot.enabled && snapshot.status !== 'revoked';
}

interface LinkCopy {
  title: string;
  intro: string;
  share: string;
  off: string;
}

export const LINK_COPY: Record<LinkKind, LinkCopy> = {
  device: {
    title: 'Add a device',
    intro:
      'Make a link for your own devices. Open it on a browser or a phone, sign in with your GitHub account and ask for access. You accept each request here.',
    share:
      'Scan this on the phone, or open the link on the device you are adding. Each device names itself and asks for access, which you accept here. The link works until you turn it off.',
    off: 'Nobody can ask for access with the old link any more.',
  },
  invite: {
    title: 'Invite someone',
    intro:
      'Make a link for other people. Whoever opens it signs in with their own GitHub account and asks for access. Accepting gives them full control of this machine.',
    share:
      'Share this link with the people you want on this machine. Each asks for access with their GitHub account, and nothing opens until you accept. The link works until you turn it off.',
    off: 'Nobody can ask to join with the old link any more.',
  },
};

export function selectLink(snapshot: RemoteSnapshot | null, kind: LinkKind) {
  return snapshot?.links.find((link) => link.kind === kind) ?? null;
}

export function describeLinkAge(link: RemoteLink, now = Date.now()) {
  return `${formatSince('Made', link.createdAt, now)}. It works until you turn it off.`;
}

const REQUEST_KIND: Record<LinkKind, string> = {
  device: 'Add device',
  invite: 'Invite',
};

export function describeAccessRequest(request: AccessRequest, now = Date.now()) {
  return `${request.deviceName} · ${REQUEST_KIND[request.kind]} · ${formatSince('Asked', request.requestedAt, now)}`;
}

export function describeAcceptOutcome(request: AccessRequest, access: RemoteAccess | null) {
  const joins =
    request.kind === 'invite' &&
    access !== null &&
    access.owner.id !== request.user.id &&
    !access.members.some((member) => member.user.id === request.user.id);
  return joins
    ? `@${request.user.login} joins this machine with full control, and ${request.deviceName} is added.`
    : `${request.deviceName} is added for @${request.user.login}.`;
}

function resolveQrPath(text: string) {
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  const cells: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) cells.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return { size, path: cells.join('') };
}

export function resolveQrImage(text: string) {
  const { size, path } = resolveQrPath(text);
  const box = size + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${box} ${box}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
