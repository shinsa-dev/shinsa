import { Schema } from 'effect';
import { isLinkProtocol, parseDeepLink } from '../deep-links/links.ts';
import {
  ALLOWED_PERMISSIONS,
  AppPath,
  EXTERNAL_PROTOCOLS,
  LOOPBACK_HOSTS,
  type Navigation,
} from './schema.ts';

export const isAppPath = Schema.is(AppPath);

export function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function isAppUrl(url: URL, origin: string) {
  const app = new URL(origin);
  const sameHost =
    url.hostname === app.hostname || (isLoopbackHost(url.hostname) && isLoopbackHost(app.hostname));
  return url.protocol === app.protocol && url.port === app.port && sameHost;
}

function isAppAddress(address: string | undefined, origin: string) {
  const url = address === undefined ? null : URL.parse(address);
  return url !== null && isAppUrl(url, origin);
}

export function resolveNavigation(target: string, origin: string): Navigation {
  const url = URL.parse(target);
  if (!url) return { kind: 'blocked' };
  if (isLinkProtocol(url.protocol)) return { kind: 'link', path: parseDeepLink(target) ?? '/' };
  if (isAppUrl(url, origin)) return { kind: 'app', path: `${url.pathname}${url.search}${url.hash}` };
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: 'external', url: url.toString() };
  return { kind: 'blocked' };
}

export function isPermissionAllowed(permission: string, requestingUrl: string, origin: string) {
  return ALLOWED_PERMISSIONS.has(permission) && isAppAddress(requestingUrl, origin);
}

export function resolveHistoryStep(
  urls: readonly string[],
  activeIndex: number,
  offset: -1 | 1,
  origin: string
) {
  const index = activeIndex + offset;
  return isAppAddress(urls[index], origin) ? index : null;
}
