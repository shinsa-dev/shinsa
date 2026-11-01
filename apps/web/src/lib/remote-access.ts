import type { AccessRequest, RemoteAccess, RemoteDevice, RemoteMember, RemoteSnapshot } from '@shinsa/core';
import { encode } from 'uqr';
import { formatSince, formatUntil } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { resolveDeviceName } from '@/lib/remote/device-name.ts';
import { describeUserName, selectDeviceMember } from '@/lib/remote/users.ts';

export const REMOTE_ACCESS_SECTION = 'Remote access';

export interface RemoteStatusView {
  label: string;
  tone: Tone;
  detail: string;
}

const STATUS_VIEW: Record<RemoteSnapshot['status'], Omit<RemoteStatusView, 'detail'>> = {
  off: { label: 'Not connected', tone: 'neutral' },
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
  return member ? `${seen} · Added by ${describeUserName(member)}` : seen;
}

export function describeMemberSince(member: RemoteMember, now = Date.now()) {
  return formatSince('Joined', member.addedAt, now);
}

export function hasThisDevice(
  snapshot: RemoteSnapshot | null,
  browser: { remote: boolean; userAgent: string; touch: boolean }
) {
  if (browser.remote) return true;
  const ownerId = snapshot?.access?.owner.id ?? null;
  const name = resolveDeviceName(browser.userAgent, browser.touch, null);
  return (snapshot?.devices ?? []).some(
    (device) => device.name === name && (device.userId === null || device.userId === ownerId)
  );
}

export function canEnrollDevices(snapshot: RemoteSnapshot | null) {
  return snapshot?.paired === true && snapshot.enabled && snapshot.status !== 'revoked';
}

export const LINK_COPY = {
  title: 'Invite link',
  intro:
    'Make one link for your own devices and for other people. Whoever opens it signs in with GitHub and asks for access. Nothing opens until you accept.',
  share:
    'Open it on your own device, or share it. Whoever opens it signs in with GitHub and asks for access, which you accept here. Accepting someone else gives them full control. The link works until you turn it off.',
};

export function describeAccessRequest(request: AccessRequest, now = Date.now()) {
  return `${request.deviceName} · ${formatSince('Asked', request.requestedAt, now)}`;
}

function joinsMachine(request: AccessRequest, access: RemoteAccess | null) {
  return (
    access !== null &&
    access.owner.id !== request.user.id &&
    !access.members.some((member) => member.user.id === request.user.id)
  );
}

export function describeAcceptOutcome(request: AccessRequest, access: RemoteAccess | null) {
  if (joinsMachine(request, access)) return `${describeUserName(request.user)} joined.`;
  return `${request.deviceName} is added.`;
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
