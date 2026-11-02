import {
  createPreviewAccessToken,
  InstanceId,
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
  serializePreviewPage,
  verifyPreviewAccessToken,
} from '@shinsa/core';
import { UrlInvalid } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { findMachineAccess } from '../auth/access.ts';
import { selectRequestUser } from '../auth/sessions.ts';
import { CloudConfig } from '../config/config.ts';
import { serializeCookie } from '../http/cookies.ts';
import { resolveForwardHeaders, TUNNEL_OFFLINE_STATUSES } from '../http/forward.ts';
import { CurrentUrl, readCookie } from '../http/request.ts';
import { NOINDEX, respondRedirect, respondText } from '../http/responses.ts';
import { Tunnels } from '../integrations/tunnels.ts';
import { type Machine, Machines } from '../store/machines.ts';
import { isMachineOnline } from '../views/machines.ts';

export const PREVIEW_COOKIE = '__Host-shinsa_preview';

export const PREVIEW_ACCESS_COOKIE = '__Host-shinsa_preview_access';

const PREVIEW_COOKIE_TTL = Duration.days(30);

const PREVIEW_COOKIES = new Set([PREVIEW_COOKIE, PREVIEW_ACCESS_COOKIE]);

const FORWARDED_AWAY = new Set(['cookie', PREVIEW_KEY_HEADER, PREVIEW_ACCESS_HEADER]);

const BODILESS_METHODS = new Set(['GET', 'HEAD']);

const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);

interface PreviewPass {
  readonly key: string | null;
  readonly access: string | null;
}

export function isPreviewHost(host: string, previewOrigin: string) {
  const zone = new URL(previewOrigin).host;
  const lower = host.toLowerCase();
  return lower === zone || lower.endsWith(`.${zone}`);
}

export function resolveForwardCookie(header: string | null) {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !PREVIEW_COOKIES.has(part.split('=')[0] ?? ''));
  return kept.length > 0 ? kept.join('; ') : null;
}

function respondPage(kind: PreviewPageKind, status: 404 | 503) {
  return respondText(serializePreviewPage(kind), {
    status,
    contentType: 'text/html; charset=utf-8',
    headers: {
      'cache-control': 'no-store',
      'x-robots-tag': NOINDEX,
      ...(status === 503 ? { 'retry-after': '30' } : {}),
    },
  });
}

function respondRobots() {
  return respondText('User-agent: *\nDisallow: /\n', {
    contentType: 'text/plain; charset=utf-8',
    headers: { 'x-robots-tag': NOINDEX },
  });
}

function respondCookieRedirect(url: URL, param: string, cookie: string) {
  const clean = new URL(url);
  clean.searchParams.delete(param);
  return respondRedirect(clean.href, {
    status: 303,
    cookies: [cookie],
    headers: { 'referrer-policy': 'no-referrer', 'x-robots-tag': NOINDEX },
  });
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

function resolvePreviewHeaders(source: Headers, pass: PreviewPass) {
  const headers = resolveForwardHeaders(source, FORWARDED_AWAY);
  const cookie = resolveForwardCookie(source.get('cookie'));
  if (cookie) headers.set('cookie', cookie);
  if (pass.key) headers.set(PREVIEW_KEY_HEADER, pass.key);
  if (pass.access) headers.set(PREVIEW_ACCESS_HEADER, pass.access);
  return headers;
}

const forward = Effect.fn('previews.forward')(function* (
  url: URL,
  machine: Machine,
  address: PreviewAddress,
  pass: PreviewPass
) {
  const tunnels = yield* Tunnels;
  const request = yield* Effect.orDie(
    HttpServerRequest.HttpServerRequest.pipe(Effect.flatMap(HttpServerRequest.toWeb))
  );
  const answer = yield* tunnels
    .request(machine.id, `${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`, {
      method: request.method,
      headers: resolvePreviewHeaders(request.headers, pass),
      body: BODILESS_METHODS.has(request.method) ? null : request.body,
    })
    .pipe(
      Effect.tapError((error) =>
        Effect.logError('[Preview] Could not reach the tunnel').pipe(
          Effect.annotateLogs({ instanceId: machine.id, error: error.message })
        )
      ),
      Effect.option
    );
  if (Option.isNone(answer)) return respondPage('offline', 503);
  const proxied = answer.value;
  if (proxied.status === 101) return HttpServerResponse.raw(proxied);
  if (TUNNEL_OFFLINE_STATUSES.has(proxied.status) && !proxied.headers.has(PREVIEW_PAGE_HEADER)) {
    yield* Effect.logError('[Preview] The tunnel did not answer').pipe(
      Effect.annotateLogs({ instanceId: machine.id, status: proxied.status })
    );
    return respondPage('offline', 503);
  }
  return HttpServerResponse.raw(
    new Response(proxied.body, {
      status: proxied.status,
      statusText: proxied.statusText,
      headers: resolveProxiedHeaders(proxied),
    })
  );
});

const selectMachine = Effect.fn('previews.selectMachine')(function* (address: PreviewAddress) {
  const machines = yield* Machines;
  const instanceId = decodeInstanceId(address.instanceId);
  return Option.isSome(instanceId) ? yield* machines.select(instanceId.value) : Option.none<Machine>();
});

const respondAccess = Effect.fn('previews.respondAccess')(function* (
  url: URL,
  address: PreviewAddress,
  token: string
) {
  const machine = yield* selectMachine(address);
  if (Option.isNone(machine)) return respondPage('gone', 404);
  const connectKey = Redacted.value(machine.value.connectKey);
  const now = yield* Clock.currentTimeMillis;
  const claim = yield* Effect.promise(() =>
    verifyPreviewAccessToken(connectKey, token, address, now, PREVIEW_OPEN_TTL_MS)
  );
  if (!claim) return respondPage('gone', 404);
  const access = yield* Effect.promise(() =>
    createPreviewAccessToken(connectKey, {
      ...address,
      userId: claim.userId,
      expiresAt: now + PREVIEW_ACCESS_TTL_MS,
    })
  );
  return respondCookieRedirect(
    url,
    PREVIEW_ACCESS_PARAM,
    serializeCookie(PREVIEW_ACCESS_COOKIE, access, Duration.millis(PREVIEW_ACCESS_TTL_MS))
  );
});

export const respondPreviewHost = Effect.fn('previews.respondHost')(function* (url: URL) {
  if (url.pathname === '/robots.txt') return respondRobots();
  const config = yield* CloudConfig;
  const address = parsePreviewHost(url.host, config.previewOrigin);
  if (!address) return respondPage('gone', 404);
  const key = url.searchParams.get(PREVIEW_KEY_PARAM);
  if (key && isPreviewKey(key))
    return respondCookieRedirect(
      url,
      PREVIEW_KEY_PARAM,
      serializeCookie(PREVIEW_COOKIE, key, PREVIEW_COOKIE_TTL)
    );
  const access = url.searchParams.get(PREVIEW_ACCESS_PARAM);
  if (access) return yield* respondAccess(url, address, access);
  const request = yield* HttpServerRequest.HttpServerRequest;
  const cookieKey = readCookie(request, PREVIEW_COOKIE);
  const pass = {
    key: cookieKey && isPreviewKey(cookieKey) ? cookieKey : null,
    access: readCookie(request, PREVIEW_ACCESS_COOKIE),
  };
  if (!(pass.key || pass.access)) return respondPage('gone', 404);
  const machine = yield* selectMachine(address);
  if (Option.isNone(machine)) return respondPage('gone', 404);
  if (!isMachineOnline(machine.value, yield* Clock.currentTimeMillis)) return respondPage('offline', 503);
  return yield* forward(url, machine.value, address, pass);
});

const readPreviewTarget = Effect.fn('previews.readTarget')(function* (url: URL, previewOrigin: string) {
  const value = url.searchParams.get('url');
  const target = value && URL.canParse(value) ? new URL(value) : null;
  const address = target && parsePreviewHost(target.host, previewOrigin);
  const instanceId = address ? decodeInstanceId(address.instanceId) : Option.none();
  if (!target || !address || Option.isNone(instanceId) || target.protocol !== new URL(previewOrigin).protocol)
    return yield* new UrlInvalid({ message: 'This is not the address of a service on a machine of yours.' });
  return { target, address, instanceId: instanceId.value };
});

const respondPreviewOpen = Effect.gen(function* () {
  const url = yield* CurrentUrl;
  const config = yield* CloudConfig;
  const { target, address, instanceId } = yield* readPreviewTarget(url, config.previewOrigin);
  const user = yield* selectRequestUser;
  if (Option.isNone(user)) {
    const signIn = new URL(REMOTE_PATHS.signIn, config.origin);
    signIn.searchParams.set('return', `${url.pathname}${url.search}`);
    return respondRedirect(signIn.href);
  }
  const { machine } = yield* findMachineAccess(user.value.id, instanceId);
  const now = yield* Clock.currentTimeMillis;
  const token = yield* Effect.promise(() =>
    createPreviewAccessToken(Redacted.value(machine.connectKey), {
      ...address,
      userId: user.value.id,
      expiresAt: now + PREVIEW_OPEN_TTL_MS,
    })
  );
  const location = new URL(`${target.origin}${target.pathname}${target.search}${target.hash}`);
  location.searchParams.delete(PREVIEW_KEY_PARAM);
  location.searchParams.set(PREVIEW_ACCESS_PARAM, token);
  return respondRedirect(location.href, { status: 303, headers: { 'referrer-policy': 'no-referrer' } });
});

export const PreviewOpenRoutes = HttpRouter.add('GET', REMOTE_PATHS.previewOpen, respondPreviewOpen);
