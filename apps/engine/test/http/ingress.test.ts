import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConnectRefused } from '@shinsa/core/engine-api/schema';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { SignInRoutes } from '../../src/http/routes/sign-in/handler.ts';
import { TunnelRoutes } from '../../src/http/routes/tunnel/handler.ts';
import { WebhookRoutes } from '../../src/http/routes/webhooks/handler.ts';
import type { HttpContext } from '../helpers/web.ts';
import { createHttpContext, createWebHandler, disposeWebHandlers, recordedLogs } from '../helpers/web.ts';

afterEach(disposeWebHandlers);

const BASE = 'http://127.0.0.1:5180';

const TestRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/api/queue', HttpServerResponse.jsonUnsafe({ decisions: [] })),
  HttpRouter.route('POST', '/api/queue', HttpServerResponse.jsonUnsafe({ wrote: true })),
  HttpRouter.route('GET', '/api/boom', Effect.die(new Error('The disk is full.'))),
  HttpRouter.route('GET', '/api/thrown', Effect.die('The socket closed.')),
  HttpRouter.route('GET', '/api/refused', Effect.fail(new ConnectRefused({ message: 'Sign in again.' }))),
  HttpRouter.route('GET', '/share', HttpServerResponse.text('share socket')),
]);

const AllRoutes = Layer.mergeAll(TestRoutes, WebhookRoutes, SignInRoutes, TunnelRoutes);

function call(handle: ReturnType<typeof createWebHandler>, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', '127.0.0.1:5180');
  return handle(new Request(`${BASE}${path}`, { ...init, headers }));
}

function post(handle: ReturnType<typeof createWebHandler>, path: string, body: string, headers = {}) {
  return call(handle, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const tunnel = { 'cf-connecting-ip': '203.0.113.9' };

function createTunnelContext(overrides: Partial<HttpContext> = {}, config = {}) {
  return createHttpContext(
    {
      remote: {
        isEnabled: Effect.succeed(true),
        tunnelHost: Effect.succeed('box.shinsa.dev'),
      } as unknown as HttpContext['remote'],
      ...overrides,
    },
    config
  );
}

describe('Ingress on this machine', () => {
  test('a foreign Host, a foreign Origin and a cross-site fetch are refused before any route runs', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    const host = await call(handle, '/api/queue', { headers: { host: 'attacker.example:5180' } });
    expect(host.status).toBe(403);
    expect(await host.json()).toEqual({
      error: { code: 'forbidden', message: 'Shinsa only answers on its own address.' },
    });
    const origin = await call(handle, '/api/queue', { headers: { origin: 'https://attacker.example' } });
    expect(await origin.json()).toEqual({
      error: { code: 'forbidden', message: 'Requests from other sites are not allowed.' },
    });
    expect((await call(handle, '/', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect(
      await (await call(handle, '/api/queue', { headers: { origin: 'http://localhost:5181' } })).json()
    ).toEqual({ decisions: [] });
  });

  test('an unknown /api path is checked like any request, then answers not_found', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    const missing = await call(handle, '/api/nothing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
    const text = await call(handle, '/api/nothing', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    });
    expect([text.status, await text.json()]).toEqual([
      415,
      { error: { code: 'content_type_invalid', message: 'Send the request body as application/json.' } },
    ]);
    const large = await post(handle, '/api/nothing', '{}', { 'content-length': String(9 * 1024 * 1024) });
    expect([large.status, await large.json()]).toEqual([
      413,
      { error: { code: 'body_too_large', message: 'The request body is over 8 MB.' } },
    ]);
    expect((await post(handle, '/api/nothing', '{}')).status).toBe(404);
    const removal = await call(handle, '/api/queue', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });
    expect(removal.status).toBe(404);
  });

  test('every other path is the web app, and says so when it is not built', async () => {
    const context = createHttpContext();
    const handle = createWebHandler(context, AllRoutes);
    expect((await call(handle, '/tasks/SW-1')).status).toBe(503);
    mkdirSync(join(context.config.webDir, 'assets'), { recursive: true });
    writeFileSync(join(context.config.webDir, 'index.html'), '<html>app</html>');
    writeFileSync(join(context.config.webDir, 'assets', 'app-1.js'), 'run()');
    expect(await (await call(handle, '/tasks/SW-1')).text()).toBe('<html>app</html>');
    const asset = await call(handle, '/assets/app-1.js');
    expect([await asset.text(), asset.headers.get('cache-control')]).toEqual([
      'run()',
      'public, max-age=31536000, immutable',
    ]);
    expect(await (await call(handle, '/health')).text()).toBe('<html>app</html>');
    expect(await (await call(handle, '/share')).text()).toBe('share socket');
  });

  test('an inspect engine reads but refuses every write with inspect_read_only', async () => {
    const handle = createWebHandler(createHttpContext({}, { inspect: true }), AllRoutes);
    expect((await call(handle, '/api/queue')).status).toBe(200);
    const write = await post(handle, '/api/queue', '{}');
    expect([write.status, await write.json()]).toEqual([
      403,
      { error: { code: 'inspect_read_only', message: 'Inspect mode is read-only.' } },
    ]);
    expect((await post(handle, '/api/hooks/s/t', '{}')).status).toBe(403);
  });

  test('a route that breaks answers request_failed with its reason, and a known failure keeps its own code', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    const broken = await call(handle, '/api/boom');
    expect([broken.status, await broken.json()]).toEqual([
      400,
      { error: { code: 'request_failed', message: 'The disk is full.' } },
    ]);
    expect(recordedLogs).toContainEqual({
      message: '[Server] Request failed',
      fields: { path: '/api/boom', error: 'The disk is full.' },
    });
    const thrown = await call(handle, '/api/thrown');
    expect([thrown.status, await thrown.json()]).toEqual([
      400,
      { error: { code: 'request_failed', message: 'The socket closed.' } },
    ]);
    const refused = await call(handle, '/api/refused');
    expect([refused.status, await refused.json()]).toEqual([
      401,
      { error: { code: 'unauthorized', message: 'Sign in again.' } },
    ]);
  });
});

describe('the webhook and sign-in routes', () => {
  test('a webhook is taken from any host, since another service calls it', async () => {
    const received: string[] = [];
    const schedules = {
      handleWebhook: (request: Request, url: URL) =>
        Effect.promise(async () => {
          received.push(`${request.method} ${url.pathname} ${await request.text()}`);
          return new Response('hooked', { status: 202 });
        }),
    } as unknown as HttpContext['schedules'];
    const handle = createWebHandler(createHttpContext({ schedules }), AllRoutes);
    const answer = await post(handle, '/api/hooks/sched/token', '{"a":1}', { host: 'hooks.example' });
    expect([answer.status, await answer.text()]).toEqual([202, 'hooked']);
    expect(received).toEqual(['POST /api/hooks/sched/token {"a":1}']);
  });

  test('without schedules a webhook path is just an unknown endpoint', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    expect(await (await post(handle, '/api/hooks/sched/token', '{}')).json()).toEqual({
      error: { code: 'not_found', message: 'No such endpoint.' },
    });
  });

  test('the sign-in page answers the provider’s redirect on Shinsa’s own address only', async () => {
    const urls: string[] = [];
    const extensions = {
      isCallback: (path: string) => path === '/api/mcp/oauth/callback',
      finishSignIn: (url: URL) =>
        Effect.sync(() => {
          urls.push(url.search);
          return '<p>Signed in</p>';
        }),
    } as unknown as HttpContext['extensions'];
    const handle = createWebHandler(createHttpContext({ extensions }), AllRoutes);
    const page = await call(handle, '/api/mcp/oauth/callback?code=c', {
      headers: { origin: 'https://auth.example', 'sec-fetch-site': 'cross-site' },
    });
    expect([page.status, await page.text(), page.headers.get('content-type')]).toEqual([
      200,
      '<p>Signed in</p>',
      'text/html; charset=utf-8',
    ]);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(urls).toEqual(['?code=c']);
    const foreign = await call(handle, '/api/mcp/oauth/callback', { headers: { host: 'evil.example' } });
    expect(foreign.status).toBe(403);
    const inspect = createWebHandler(createHttpContext({ extensions }, { inspect: true }), AllRoutes);
    expect((await call(inspect, '/api/mcp/oauth/callback')).status).toBe(403);
    const remote = await handle(new Request(`${BASE}/api/mcp/oauth/callback`), {
      via: 'channel',
      guest: null,
      userId: null,
    });
    expect(await remote.json()).toEqual({
      error: { code: 'local_only', message: 'Do this on the machine Shinsa runs on.' },
    });
    const guest = await handle(new Request(`${BASE}/api/mcp/oauth/callback`), {
      via: 'channel',
      guest: { taskId: 't', name: 'Kai' } as never,
      userId: null,
    });
    expect((await guest.json()) as unknown).toMatchObject({ error: { code: 'handoff_scope' } });
  });

  test('without extensions the sign-in path is an unknown endpoint', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    expect((await call(handle, '/api/mcp/oauth/callback')).status).toBe(404);
  });
});

describe('Ingress through the tunnel', () => {
  test('only the tunnel’s plain routes answer, its sockets open only as an upgrade, and the rest is not found', async () => {
    const handle = createWebHandler(createTunnelContext(), AllRoutes);
    expect(await (await call(handle, '/health', { headers: tunnel })).json()).toEqual({ ok: true });
    expect(await (await call(handle, '/health', { headers: { host: 'box.shinsa.dev' } })).json()).toEqual({
      ok: true,
    });
    for (const path of ['/api/queue', '/', '/api/boom']) {
      const answer = await call(handle, path, { headers: tunnel });
      expect([answer.status, await answer.json()]).toEqual([
        404,
        { error: { code: 'not_found', message: 'No such endpoint.' } },
      ]);
    }
    expect((await call(handle, '/share', { headers: tunnel })).status).toBe(404);
    expect((await call(handle, '/team', { headers: tunnel })).status).toBe(404);
    expect((await call(handle, '/remote', { headers: tunnel })).status).toBe(404);
  });

  test('a tunnel that is switched off answers nothing', async () => {
    const context = createHttpContext({
      remote: {
        isEnabled: Effect.succeed(false),
        tunnelHost: Effect.succeed(null),
      } as unknown as HttpContext['remote'],
    });
    const handle = createWebHandler(context, AllRoutes);
    expect((await call(handle, '/health', { headers: tunnel })).status).toBe(404);
  });

  test('Slack’s events reach Slack, and an inspect engine refuses them', async () => {
    const seen: string[] = [];
    const slack = {
      handleTunnel: (request: Request, url: URL) =>
        Effect.sync(() => {
          seen.push(`${request.method} ${url.pathname}`);
          return new Response('ok');
        }),
    } as unknown as HttpContext['slack'];
    const handle = createWebHandler(createTunnelContext({ slack }), AllRoutes);
    expect(await (await post(handle, '/api/slack/events', '{}', tunnel)).text()).toBe('ok');
    expect(await (await post(handle, '/api/slack/interactions', 'payload=x', tunnel)).text()).toBe('ok');
    expect(seen).toEqual(['POST /api/slack/events', 'POST /api/slack/interactions']);
    expect((await post(handle, '/api/slack/events', '{}')).status).toBe(404);
    const inspect = createWebHandler(createTunnelContext({ slack }, { inspect: true }), AllRoutes);
    expect(await (await post(inspect, '/api/slack/events', '{}', tunnel)).json()).toMatchObject({
      error: { code: 'inspect_read_only' },
    });
    const without = createWebHandler(createTunnelContext(), AllRoutes);
    expect((await post(without, '/api/slack/events', '{}', tunnel)).status).toBe(404);
  });

  test('a webhook through the tunnel reaches its schedule', async () => {
    const schedules = {
      handleWebhook: () => Effect.sync(() => new Response('hooked')),
    } as unknown as HttpContext['schedules'];
    const handle = createWebHandler(createTunnelContext({ schedules }), AllRoutes);
    expect(await (await post(handle, '/api/hooks/s/t', '{}', tunnel)).text()).toBe('hooked');
  });
});

describe('Ingress inside the remote channel', () => {
  test('only /api answers, and a guest is refused what is not theirs before not_found', async () => {
    const handle = createWebHandler(createHttpContext(), AllRoutes);
    const page = await handle(new Request(`${BASE}/tasks/SW-1`), {
      via: 'channel',
      guest: null,
      userId: null,
    });
    expect(page.status).toBe(404);
    expect(
      await (
        await handle(new Request(`${BASE}/api/queue`), { via: 'channel', guest: null, userId: null })
      ).json()
    ).toEqual({ decisions: [] });
    expect(
      (await handle(new Request(`${BASE}/api/nothing`), { via: 'channel', guest: null, userId: null })).status
    ).toBe(404);
    const guest = await handle(new Request(`${BASE}/api/nothing`), {
      via: 'channel',
      guest: { taskId: 't', name: 'Kai' } as never,
      userId: null,
    });
    expect([guest.status, ((await guest.json()) as { error: { code: string } }).error.code]).toEqual([
      403,
      'handoff_scope',
    ]);
  });
});
