import { CACHE_ORIGIN, type Channel, DMG_NAME } from '../releases/schema.ts';

export function resolveChannel(pathname: string): Channel | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/download') return 'stable';
  if (path === '/download/beta') return 'beta';
  if (path === '/download/canary') return 'canary';
  return null;
}

export function resolveVersionChannel(pathname: string): Channel | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/download/version') return 'stable';
  if (path === '/download/version/beta') return 'beta';
  if (path === '/download/version/canary') return 'canary';
  return null;
}

export function resolveChannelKey(channel: Channel) {
  return `channels/${channel}.json`;
}

export function resolveReleaseKey(version: string) {
  return `releases/${version}/${DMG_NAME}`;
}

export function resolvePointerCacheKey(channel: Channel) {
  return `${CACHE_ORIGIN}/${resolveChannelKey(channel)}`;
}
