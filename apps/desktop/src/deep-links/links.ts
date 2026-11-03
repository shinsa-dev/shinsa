import { Result } from 'effect';
import { LINK_PAGES, LINK_PROTOCOL, TASK_REFERENCE, URL_SCHEME } from './schema.ts';

function decodeSegment(segment: string) {
  return Result.getOrNull(Result.try(() => decodeURIComponent(segment)));
}

function listSegments(url: URL) {
  return `${url.host}${url.pathname}`.split('/').filter(Boolean);
}

function resolveTaskPath(segment: string | undefined) {
  const reference = segment === undefined ? null : decodeSegment(segment);
  if (!reference || !TASK_REFERENCE.test(reference)) return '/';
  return `/tasks/${encodeURIComponent(reference)}`;
}

export function isLinkProtocol(protocol: string) {
  return protocol.toLowerCase() === `${URL_SCHEME}:`;
}

export function parseDeepLink(raw: string) {
  const url = URL.parse(raw);
  if (!url || !isLinkProtocol(url.protocol)) return null;
  const [kind = '', reference, ...rest] = listSegments(url);
  const name = kind.toLowerCase();
  if (name === 'task' && rest.length === 0) return resolveTaskPath(reference);
  if (reference === undefined) return LINK_PAGES[name] ?? '/';
  return '/';
}

export function findDeepLink(argv: readonly string[]) {
  return argv.find((argument) => isLinkProtocol(LINK_PROTOCOL.exec(argument)?.[0] ?? '')) ?? null;
}
