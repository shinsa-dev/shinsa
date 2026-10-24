import { parseDeepLink, URL_SCHEME } from './deep-link.ts';

export type Navigation =
  | { kind: 'app'; path: string }
  | { kind: 'link'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked' };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const MAX_PATH_LENGTH = 2048;

const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

export function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function isSameHost(left: string, right: string) {
  return left === right || (isLoopbackHost(left) && isLoopbackHost(right));
}

export function isAppUrl(url: URL, origin: string) {
  const app = new URL(origin);
  return url.protocol === app.protocol && url.port === app.port && isSameHost(url.hostname, app.hostname);
}

export function isAppPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH) return false;
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

export function resolveNavigation(target: string, origin: string): Navigation {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { kind: 'blocked' };
  }
  if (url.protocol === `${URL_SCHEME}:`) return { kind: 'link', path: parseDeepLink(target) ?? '/' };
  if (isAppUrl(url, origin)) return { kind: 'app', path: `${url.pathname}${url.search}${url.hash}` };
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: 'external', url: url.toString() };
  return { kind: 'blocked' };
}

export function isPermissionAllowed(permission: string, requestingUrl: string, origin: string) {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  try {
    return isAppUrl(new URL(requestingUrl), origin);
  } catch {
    return false;
  }
}
