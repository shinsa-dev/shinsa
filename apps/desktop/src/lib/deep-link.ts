import { APP_IDENTITY } from '@shinsa/core';

export const URL_SCHEME = APP_IDENTITY.scheme;

const TASK_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const PAGES: Record<string, string> = {
  '': '/',
  home: '/',
  tasks: '/tasks',
  settings: '/settings',
};

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function listSegments(url: URL) {
  return `${url.host}${url.pathname}`.split('/').filter(Boolean);
}

function resolveTaskPath(segment: string | undefined) {
  const reference = segment === undefined ? null : decodeSegment(segment);
  if (!reference || !TASK_REFERENCE.test(reference)) return '/';
  return `/tasks/${encodeURIComponent(reference)}`;
}

export function parseDeepLink(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!isLinkProtocol(url.protocol)) return null;
  const [kind = '', reference, ...rest] = listSegments(url);
  const name = kind.toLowerCase();
  if (name === 'task' && rest.length === 0) return resolveTaskPath(reference);
  if (reference === undefined) return PAGES[name] ?? '/';
  return '/';
}

export function isLinkProtocol(protocol: string) {
  return protocol.toLowerCase() === `${URL_SCHEME}:`;
}

export function findDeepLink(argv: readonly string[]) {
  return argv.find((argument) => isLinkProtocol(/^[a-z-]+:/i.exec(argument)?.[0] ?? '')) ?? null;
}
