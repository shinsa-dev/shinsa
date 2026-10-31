import { DEVICE_NAME_LIMIT, type RemoteUser } from '@shinsa/core';

const DEVICES: { pattern: RegExp; name: string }[] = [
  { pattern: /iPad/, name: 'iPad' },
  { pattern: /iPhone/, name: 'iPhone' },
  { pattern: /Android.*Mobile/, name: 'Android phone' },
  { pattern: /Android/, name: 'Android tablet' },
  { pattern: /Macintosh|Mac OS X/, name: 'Mac' },
  { pattern: /Windows/, name: 'Windows PC' },
  { pattern: /CrOS/, name: 'Chromebook' },
  { pattern: /Linux/, name: 'Linux PC' },
];

const BROWSERS: { pattern: RegExp; name: string }[] = [
  { pattern: /Edg\//, name: 'Edge' },
  { pattern: /OPR\//, name: 'Opera' },
  { pattern: /Firefox\/|FxiOS\//, name: 'Firefox' },
  { pattern: /Chrome\/|CriOS\//, name: 'Chrome' },
  { pattern: /Safari\//, name: 'Safari' },
];

function resolveDevice(userAgent: string, touch: boolean) {
  if (touch && /Macintosh/.test(userAgent)) return 'iPad';
  return DEVICES.find((entry) => entry.pattern.test(userAgent))?.name ?? 'Browser';
}

function resolveBrowser(userAgent: string) {
  return BROWSERS.find((entry) => entry.pattern.test(userAgent))?.name ?? null;
}

function resolveFirstName(user: RemoteUser) {
  const [first] = (user.name ?? '').trim().split(/\s+/);
  return first ? first : user.login;
}

export function resolveDeviceName(userAgent: string, touch: boolean, invitee: RemoteUser | null) {
  const device = resolveDevice(userAgent, touch);
  const browser = /iPhone|iPad|Android/.test(device) ? null : resolveBrowser(userAgent);
  const base = browser ? `${browser} on ${device}` : device;
  const name = invitee ? `${resolveFirstName(invitee)} ${base}` : base;
  return name.slice(0, DEVICE_NAME_LIMIT);
}
