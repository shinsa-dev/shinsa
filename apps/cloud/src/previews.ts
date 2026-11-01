import {
  createPreviewAccessToken,
  isPreviewKey,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_ACCESS_PARAM,
  PREVIEW_ACCESS_TTL_MS,
  PREVIEW_KEY_HEADER,
  PREVIEW_KEY_PARAM,
  PREVIEW_OPEN_TTL_MS,
  PREVIEW_PAGE_HEADER,
  type PreviewAddress,
  type PreviewPageKind,
  parsePreviewHost,
  REMOTE_PATHS,
  resolvePreviewTunnelPath,
  resolveTunnelHost,
  serializePreviewPage,
  verifyPreviewAccessToken,
} from '@shinsa/core';
import { TUNNEL_OFFLINE_STATUSES } from './hooks.ts';
import { CloudError, readCookie } from './http.ts';
import { findInstanceAccess, isInstanceOnline, NOINDEX } from './instances.ts';
import { recordFailure } from './log.ts';
import { selectSessionUser } from './session.ts';
import type { CloudWorld } from './world.ts';

export const PREVIEW_COOKIE = '__Host-shinsa_preview';

export const PREVIEW_ACCESS_COOKIE = '__Host-shinsa_preview_access';

const PREVIEW_COOKIE_SECONDS = 30 * 24 * 60 * 60;

const PREVIEW_COOKIES = new Set([PREVIEW_COOKIE, PREVIEW_ACCESS_COOKIE]);

const DROPPED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'cdn-loop',
  PREVIEW_KEY_HEADER,
  PREVIEW_ACCESS_HEADER,
]);

const DROPPED_PREFIXES = ['cf-', 'x-forwarded-', 'x-real-ip'];

export function isPreviewHost(host: string, previewOrigin: string) {
  const zone = new URL(previewOrigin).host;
  const lower = host.toLowerCase();
  return lower === zone || lower.endsWith(`.${zone}`);
}

function respondPage(kind: PreviewPageKind, status: number) {
  return new Response(serializePreviewPage(kind), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': NOINDEX,
      ...(status === 503 ? { 'retry-after': '30' } : {}),
    },
  });
}

function respondRobots() {
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': NOINDEX },
  });
}

function respondCookieRedirect(url: URL, param: string, cookie: string, maxAgeSeconds: number) {
  const clean = new URL(url);
  clean.searchParams.delete(param);
  return new Response(null, {
    status: 303,
    headers: {
      location: clean.href,
      'set-cookie': `${cookie}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': NOINDEX,
    },
  });
}

export function resolveForwardCookie(header: string | null) {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !PREVIEW_COOKIES.has(part.split('=')[0] ?? ''));
  return kept.length > 0 ? kept.join('; ') : null;
}

interface PreviewPass {
  key: string | null;
  access: string | null;
}

function resolveForwardHeaders(request: Request, pass: PreviewPass) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (name === 'cookie' || DROPPED_HEADERS.has(name)) continue;
    if (DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers.set(name, value);
  }
  const cookie = resolveForwardCookie(request.headers.get('cookie'));
  if (cookie) headers.set('cookie', cookie);
  if (pass.key) headers.set(PREVIEW_KEY_HEADER, pass.key);
  if (pass.access) headers.set(PREVIEW_ACCESS_HEADER, pass.access);
  return headers;
}

function resolveHostOnlyCookie(header: string) {
  const [pair = '', ...attributes] = header.split(';');
  return [pair, ...attributes.filter((part) => !/^\s*domain\s*(=|$)/i.test(part))].join(';');
}

function resolveProxiedHeaders(answer: Response) {
  const headers = new Headers(answer.headers);
  headers.delete(PREVIEW_PAGE_HEADER);
  headers.delete('set-cookie');
  for (const cookie of answer.headers.getSetCookie())
    headers.append('set-cookie', resolveHostOnlyCookie(cookie));
  headers.set('x-robots-tag', NOINDEX);
  return headers;
}

function readBody(request: Request) {
  return request.method === 'GET' || request.method === 'HEAD' ? null : request.body;
}

async function forward(
  request: Request,
  url: URL,
  address: PreviewAddress,
  pass: PreviewPass,
  world: CloudWorld
) {
  const target = `https://${resolveTunnelHost(address.instanceId)}${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`;
  let answer: Response;
  try {
    answer = await world.fetch(target, {
      method: request.method,
      headers: resolveForwardHeaders(request, pass),
      body: readBody(request),
      redirect: 'manual',
    });
  } catch (error) {
    recordFailure('[Preview] Could not reach the tunnel', {
      instanceId: address.instanceId,
      error: String(error),
    });
    return respondPage('offline', 503);
  }
  if (answer.status === 101) return answer;
  if (TUNNEL_OFFLINE_STATUSES.has(answer.status) && !answer.headers.has(PREVIEW_PAGE_HEADER)) {
    recordFailure('[Preview] The tunnel did not answer', {
      instanceId: address.instanceId,
      status: answer.status,
    });
    return respondPage('offline', 503);
  }
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers: resolveProxiedHeaders(answer),
  });
}

async function respondAccessRedirect(url: URL, address: PreviewAddress, token: string, world: CloudWorld) {
  const row = await world.store.selectInstance(address.instanceId);
  const now = world.now();
  const claim =
    row && (await verifyPreviewAccessToken(row.connect_key, token, address, now, PREVIEW_OPEN_TTL_MS));
  if (!(row && claim)) return respondPage('gone', 404);
  const access = await createPreviewAccessToken(row.connect_key, {
    ...address,
    userId: claim.userId,
    expiresAt: now + PREVIEW_ACCESS_TTL_MS,
  });
  return respondCookieRedirect(
    url,
    PREVIEW_ACCESS_PARAM,
    `${PREVIEW_ACCESS_COOKIE}=${access}`,
    PREVIEW_ACCESS_TTL_MS / 1000
  );
}

function readPass(request: Request): PreviewPass {
  const key = readCookie(request, PREVIEW_COOKIE);
  return {
    key: key && isPreviewKey(key) ? key : null,
    access: readCookie(request, PREVIEW_ACCESS_COOKIE),
  };
}

export async function respondPreview(request: Request, url: URL, world: CloudWorld) {
  if (url.pathname === '/robots.txt') return respondRobots();
  const address = parsePreviewHost(url.host, world.config.previewOrigin);
  if (!address) return respondPage('gone', 404);
  const query = url.searchParams.get(PREVIEW_KEY_PARAM);
  if (query && isPreviewKey(query))
    return respondCookieRedirect(
      url,
      PREVIEW_KEY_PARAM,
      `${PREVIEW_COOKIE}=${query}`,
      PREVIEW_COOKIE_SECONDS
    );
  const access = url.searchParams.get(PREVIEW_ACCESS_PARAM);
  if (access) return respondAccessRedirect(url, address, access, world);
  const pass = readPass(request);
  if (!(pass.key || pass.access)) return respondPage('gone', 404);
  const row = await world.store.selectInstance(address.instanceId);
  if (!row) return respondPage('gone', 404);
  if (!isInstanceOnline(row, world.now())) return respondPage('offline', 503);
  return forward(request, url, address, pass, world);
}

function readPreviewTarget(url: URL, previewOrigin: string) {
  const value = url.searchParams.get('url');
  try {
    const target = value ? new URL(value) : null;
    const address = target && parsePreviewHost(target.host, previewOrigin);
    if (target && address && target.protocol === new URL(previewOrigin).protocol) return { target, address };
  } catch {}
  throw new CloudError('url_invalid', 'This is not the address of a service on a machine of yours.', 400);
}

export async function respondPreviewOpen(request: Request, url: URL, world: CloudWorld) {
  const { target, address } = readPreviewTarget(url, world.config.previewOrigin);
  const user = await selectSessionUser(request, world);
  if (!user) {
    const signIn = new URL(REMOTE_PATHS.signIn, world.config.origin);
    signIn.searchParams.set('return', `${url.pathname}${url.search}`);
    return new Response(null, {
      status: 302,
      headers: { location: signIn.href, 'cache-control': 'no-store' },
    });
  }
  const { row } = await findInstanceAccess(user, address.instanceId, world);
  const token = await createPreviewAccessToken(row.connect_key, {
    ...address,
    userId: user.id,
    expiresAt: world.now() + PREVIEW_OPEN_TTL_MS,
  });
  const location = new URL(`${target.origin}${target.pathname}${target.search}${target.hash}`);
  location.searchParams.delete(PREVIEW_KEY_PARAM);
  location.searchParams.set(PREVIEW_ACCESS_PARAM, token);
  return new Response(null, {
    status: 303,
    headers: { location: location.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}
