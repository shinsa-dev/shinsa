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
  resolvePreviewTunnelPath,
  serializePreviewPage,
  verifyPreviewAccessToken,
} from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Schema } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { CloudConfig } from '../../config/service.ts';
import { isMachineOnline } from '../../domain/machines.ts';
import { serializeCookie } from '../../http/cookies.ts';
import { isTunnelOffline, recordMachineOffline, resolveForwardHeaders } from '../../http/forward.ts';
import { readCookie } from '../../http/request.ts';
import { NOINDEX, respondRedirect, respondText } from '../../http/responses.ts';
import { Tunnels } from '../../integrations/tunnels/service.ts';
import type { Machine } from '../../store/machines/schema.ts';
import { Machines } from '../../store/machines/service.ts';
import { resolveForwardCookie } from './address.ts';
import {
  BODILESS_METHODS,
  FORWARDED_AWAY,
  PREVIEW_ACCESS_COOKIE,
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_TTL,
  type PreviewPass,
} from './schema.ts';

export class PreviewHost extends Context.Service<
  PreviewHost,
  {
    respond(
      url: URL
    ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>;
  }
>()('shinsa/cloud/routes/PreviewHost') {
  static readonly layer = Layer.effect(
    PreviewHost,
    Effect.gen(function* () {
      const config = yield* CloudConfig;
      const tunnels = yield* Tunnels;
      const machines = yield* Machines;
      const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);

      const respondPage = (kind: PreviewPageKind, status: 404 | 503) => {
        return respondText(serializePreviewPage(kind), {
          status,
          contentType: 'text/html; charset=utf-8',
          headers: {
            'cache-control': 'no-store',
            'x-robots-tag': NOINDEX,
            ...(status === 503 ? { 'retry-after': '30' } : {}),
          },
        });
      };

      const respondRobots = () => {
        return respondText('User-agent: *\nDisallow: /\n', {
          contentType: 'text/plain; charset=utf-8',
          headers: { 'x-robots-tag': NOINDEX },
        });
      };

      const respondCookieRedirect = (url: URL, param: string, cookie: string) => {
        const clean = new URL(url);
        clean.searchParams.delete(param);
        return respondRedirect(clean.href, {
          status: 303,
          cookies: [cookie],
          headers: { 'referrer-policy': 'no-referrer', 'x-robots-tag': NOINDEX },
        });
      };

      const resolveHostOnlyCookie = (header: string) => {
        const [pair = '', ...attributes] = header.split(';');
        return [pair, ...attributes.filter((part) => !/^\s*domain\s*(=|$)/i.test(part))].join(';');
      };

      const resolveProxiedHeaders = (answer: Response) => {
        const headers = new Headers(answer.headers);
        headers.delete(PREVIEW_PAGE_HEADER);
        headers.delete('set-cookie');
        for (const cookie of answer.headers.getSetCookie())
          headers.append('set-cookie', resolveHostOnlyCookie(cookie));
        headers.set('x-robots-tag', NOINDEX);
        return headers;
      };

      const resolvePreviewHeaders = (source: Headers, pass: PreviewPass) => {
        const headers = resolveForwardHeaders(source, FORWARDED_AWAY);
        const cookie = resolveForwardCookie(source.get('cookie'));
        if (cookie) headers.set('cookie', cookie);
        if (pass.key) headers.set(PREVIEW_KEY_HEADER, pass.key);
        if (pass.access) headers.set(PREVIEW_ACCESS_HEADER, pass.access);
        return headers;
      };

      const forward = Effect.fn('previews.forward')(function* (
        url: URL,
        machine: Machine,
        address: PreviewAddress,
        pass: PreviewPass
      ) {
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
            Effect.tapError((error) => recordMachineOffline('preview', machine.id, { error: error.message })),
            Effect.option
          );
        if (Option.isNone(answer)) return respondPage('offline', 503);
        const proxied = answer.value;
        if (proxied.status === 101) return HttpServerResponse.raw(proxied);
        if (isTunnelOffline(proxied) && !proxied.headers.has(PREVIEW_PAGE_HEADER)) {
          yield* recordMachineOffline('preview', machine.id, { status: proxied.status });
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

      const respond = Effect.fn('previews.respondHost')(function* (url: URL) {
        if (url.pathname === '/robots.txt') return respondRobots();
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
        if (!isMachineOnline(machine.value, yield* Clock.currentTimeMillis))
          return respondPage('offline', 503);
        return yield* forward(url, machine.value, address, pass);
      });

      return PreviewHost.of({ respond });
    })
  );
}
