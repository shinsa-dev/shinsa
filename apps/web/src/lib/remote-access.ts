import type {
  EnrollmentKind,
  RemoteAccess,
  RemoteDevice,
  RemoteEnrollment,
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
      detail: 'Turn it on to sign in with GitHub. This machine then shows up at app.shinsa.dev.',
    };
  const owner = snapshot.owner ? `Signed in as ${snapshot.owner}.` : 'Signed in.';
  if (snapshot.status === 'revoked')
    return {
      ...STATUS_VIEW.revoked,
      detail: 'This machine was removed at app.shinsa.dev. Remove it here, then turn remote access on again.',
    };
  if (!snapshot.enabled)
    return { label: 'Paused', tone: 'neutral', detail: `${owner} Resume to reach this machine again.` };
  return { ...STATUS_VIEW[snapshot.status], detail: `${owner} Open it at app.shinsa.dev.` };
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

export function selectEnrolledDevice(devices: RemoteDevice[], enrollment: RemoteEnrollment | null) {
  if (!enrollment) return null;
  return devices.find((device) => device.enrollmentId === enrollment.id) ?? null;
}

export function isEnrollmentExpired(expiresAt: number, now = Date.now()) {
  return expiresAt <= now;
}

export type EnrollmentState = 'live' | 'expired' | 'stopped';

export function canEnrollDevices(snapshot: RemoteSnapshot | null) {
  return snapshot?.paired === true && snapshot.enabled && snapshot.status !== 'revoked';
}

export function resolveEnrollmentState(
  enrollment: RemoteEnrollment | null,
  stoppedId: string | null,
  now = Date.now()
): EnrollmentState {
  if (enrollment && enrollment.id === stoppedId) return 'stopped';
  if (enrollment && isEnrollmentExpired(enrollment.expiresAt, now)) return 'expired';
  return 'live';
}

interface LinkCopy {
  title: string;
  titleFor: (name: string) => string;
  field: string;
  placeholder: string;
  intro: string;
  verb: string;
  unused: string;
  live: string;
}

export const LINK_COPY: Record<EnrollmentKind, LinkCopy> = {
  device: {
    title: 'Add a device',
    titleFor: (name) => `Add ${name}`,
    field: 'Device name',
    placeholder: 'For example, iPhone',
    intro: 'Name the device you are adding, a browser or a phone. Shinsa makes a one-time link for it.',
    verb: 'add',
    unused: 'before a device used it',
    live: 'Scan this on the phone, or open the link on the device you are adding, and sign in with GitHub.',
  },
  invite: {
    title: 'Invite someone',
    titleFor: (name) => `Invite for ${name}`,
    field: 'Who it is for',
    placeholder: 'For example, Bob’s laptop',
    intro:
      'Say who the invite is for. Shinsa makes a one-time link they open with their own GitHub account, which gives them full control of this machine from app.shinsa.dev.',
    verb: 'invite',
    unused: 'before anyone used it',
    live: 'Send this link to them. They open it on their own device and sign in with their own GitHub account. Only send it to someone you trust with this machine.',
  },
};

export function describeEnrollmentStep(
  kind: EnrollmentKind,
  enrollment: RemoteEnrollment | null,
  state: EnrollmentState
) {
  const copy = LINK_COPY[kind];
  if (!enrollment) return copy.intro;
  if (state === 'stopped')
    return `Remote access stopped, so this link no longer works. Make a new one to ${copy.verb} ${enrollment.name} once it is on again.`;
  if (state === 'expired')
    return `This link expired ${copy.unused}. Make a new one to ${copy.verb} ${enrollment.name}.`;
  return copy.live;
}

export function describeEnrollmentExpiry(expiresAt: number, now = Date.now()) {
  if (isEnrollmentExpired(expiresAt, now)) return 'This link expired. Make a new one.';
  return `${formatUntil('It works once and expires', expiresAt, now)}.`;
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
