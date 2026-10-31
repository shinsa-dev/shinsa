import type { RemoteDevice, RemoteEnrollment, RemoteSnapshot } from '@shinsa/core';
import { encode } from 'uqr';
import { formatSince, formatUntil } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';

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

export function selectEnrolledDevice(devices: RemoteDevice[], enrollment: RemoteEnrollment | null) {
  if (!enrollment) return null;
  return devices.find((device) => device.enrollmentId === enrollment.id) ?? null;
}

export function isEnrollmentExpired(expiresAt: number, now = Date.now()) {
  return expiresAt <= now;
}

export function describeEnrollmentStep(enrollment: RemoteEnrollment | null, expired: boolean) {
  if (!enrollment)
    return 'Name the device you are adding, a browser or a phone. Shinsa makes a one-time link for it.';
  if (expired) return `This link expired before a device used it. Make a new one to add ${enrollment.name}.`;
  return 'Scan this on the phone, or open the link on the device you are adding, and sign in with GitHub.';
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
