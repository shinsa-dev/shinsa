import {
  isPreviewKey,
  PREVIEW_GONE,
  PREVIEW_KEY_HEADER,
  PREVIEW_KEY_PARAM,
  PREVIEW_OFFLINE,
  PREVIEW_PAGE_HEADER,
  type PreviewAddress,
  parsePreviewHost,
  resolvePreviewTunnelPath,
  resolveTunnelHost,
  serializePreviewPage,
} from '@shinsa/core';
import { TUNNEL_OFFLINE_STATUSES } from './hooks.ts';
import { readCookie } from './http.ts';
import { isInstanceOnline, NOINDEX } from './instances.ts';
import type { CloudWorld } from './world.ts';

export const PREVIEW_COOKIE = '__Host-shinsa_preview';

const PREVIEW_COOKIE_SECONDS = 30 * 24 * 60 * 60;

const DROPPED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cdn-loop']);

const DROPPED_PREFIXES = ['cf-', 'x-forwarded-', 'x-real-ip'];

export function isPreviewHost(host: string, previewOrigin: string) {
  const zone = new URL(previewOrigin).host;
  const lower = host.toLowerCase();
  return lower === zone || lower.endsWith(`.${zone}`);
}

function respondPage(message: string, status: number) {
  return new Response(serializePreviewPage(message), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': NOINDEX,
      ...(status === 503 ? { 'retry-after': '30' } : {}),
    },
  });
}

function respondKeyRedirect(url: URL, key: string) {
  const clean = new URL(url);
  clean.searchParams.delete(PREVIEW_KEY_PARAM);
  return new Response(null, {
    status: 303,
    headers: {
      location: `${clean.pathname}${clean.search}`,
      'set-cookie': `${PREVIEW_COOKIE}=${key}; Path=/; Max-Age=${PREVIEW_COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
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
    .filter((part) => part !== '' && part.split('=')[0] !== PREVIEW_COOKIE);
  return kept.length > 0 ? kept.join('; ') : null;
}

function resolveForwardHeaders(request: Request, key: string) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (name === 'cookie' || DROPPED_HEADERS.has(name)) continue;
    if (DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers.set(name, value);
  }
  const cookie = resolveForwardCookie(request.headers.get('cookie'));
  if (cookie) headers.set('cookie', cookie);
  headers.set(PREVIEW_KEY_HEADER, key);
  return headers;
}

function readBody(request: Request) {
  return request.method === 'GET' || request.method === 'HEAD' ? null : request.body;
}

async function forward(request: Request, url: URL, address: PreviewAddress, key: string, world: CloudWorld) {
  const target = `https://${resolveTunnelHost(address.instanceId)}${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`;
  let answer: Response;
  try {
    answer = await world.fetch(target, {
      method: request.method,
      headers: resolveForwardHeaders(request, key),
      body: readBody(request),
      redirect: 'manual',
    });
  } catch {
    return respondPage(PREVIEW_OFFLINE, 503);
  }
  if (answer.status === 101) return answer;
  const fromMachine = answer.headers.has(PREVIEW_PAGE_HEADER);
  if (TUNNEL_OFFLINE_STATUSES.has(answer.status) && !fromMachine) return respondPage(PREVIEW_OFFLINE, 503);
  const proxied = new Response(answer.body, answer);
  proxied.headers.delete(PREVIEW_PAGE_HEADER);
  proxied.headers.set('x-robots-tag', NOINDEX);
  return proxied;
}

export async function respondPreview(request: Request, url: URL, world: CloudWorld) {
  const address = parsePreviewHost(url.host, world.config.previewOrigin);
  if (!address) return respondPage(PREVIEW_GONE, 404);
  const query = url.searchParams.get(PREVIEW_KEY_PARAM);
  if (query && isPreviewKey(query)) return respondKeyRedirect(url, query);
  const key = readCookie(request, PREVIEW_COOKIE);
  if (!(key && isPreviewKey(key))) return respondPage(PREVIEW_GONE, 404);
  const row = await world.store.selectInstance(address.instanceId);
  if (!row) return respondPage(PREVIEW_GONE, 404);
  if (!isInstanceOnline(row, world.now())) return respondPage(PREVIEW_OFFLINE, 503);
  return forward(request, url, address, key, world);
}
