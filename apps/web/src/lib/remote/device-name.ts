import { DEVICE_NAME_LIMIT, type RemoteUser, resolveFirstName } from '@shinsa/core';

const DEVICES: { pattern: RegExp; name: string }[] = [
  { pattern: /iPad/, name: 'iPad' },
  { pattern: /iPhone/, name: 'iPhone' },
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

const ANDROID_MODEL = /Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build\/[^;)]*)?[;)]/i;

function resolveAndroidModel(userAgent: string) {
  const model = ANDROID_MODEL.exec(userAgent)?.[1]?.trim();
  return model && model !== 'K' ? model : null;
}

function resolveDevice(userAgent: string, touch: boolean) {
  if (touch && /Macintosh/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent))
    return resolveAndroidModel(userAgent) ?? (/Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet');
  return DEVICES.find((entry) => entry.pattern.test(userAgent))?.name ?? 'Browser';
}

function resolveBrowser(userAgent: string) {
  return BROWSERS.find((entry) => entry.pattern.test(userAgent))?.name ?? null;
}

const MOBILE = /iPhone|iPad|Android/;

export function resolveDeviceName(userAgent: string, touch: boolean, invitee: RemoteUser | null) {
  const device = resolveDevice(userAgent, touch);
  const mobile = MOBILE.test(userAgent) || device === 'iPad';
  const browser = mobile ? null : resolveBrowser(userAgent);
  const base = browser ? `${browser} on ${device}` : device;
  const name = invitee ? `${resolveFirstName(invitee)} ${base}` : base;
  return name.slice(0, DEVICE_NAME_LIMIT);
}
