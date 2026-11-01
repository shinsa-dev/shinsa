import { describe, expect, test } from 'bun:test';
import {
  PREVIEW_GONE,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  PREVIEW_OFFLINE,
  resolvePreviewOrigin,
  serializeBase64Url,
  serializePreviewUrl,
} from '@shinsa/core';
import { PREVIEW_COOKIE, resolveForwardCookie } from '../src/previews.ts';
import { respond } from '../src/router.ts';
import { createHarness, type Harness, heartbeat, pairMachine } from './harness.ts';

const PREVIEW_ID = serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(7));

const KEY = serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(9));

async function shareMachine(harness: Harness) {
  const credentials = await pairMachine(harness, await harness.signIn('mona', 1));
  await heartbeat(harness, credentials);
  const address = { instanceId: credentials.instanceId, previewId: PREVIEW_ID };
  return {
    credentials,
    origin: resolvePreviewOrigin(address),
    link: serializePreviewUrl({ ...address, key: KEY }),
  };
}

function visit(harness: Harness, url: string, init: RequestInit = {}) {
  return respond(new Request(url, { redirect: 'manual', ...init }), harness.world);
}

function withKey(init: RequestInit = {}, extra = '') {
  return { ...init, headers: { cookie: `${PREVIEW_COOKIE}=${KEY}${extra}`, ...init.headers } };
}

describe('a preview link', () => {
  test('trades the key in the address for a cookie on that host alone, keeping the rest of the address', async () => {
    const harness = createHarness();
    const { link } = await shareMachine(harness);
    const answer = await visit(harness, link.replace('/?', '/docs/start?tab=2&'));
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/docs/start?tab=2');
    expect(answer.headers.get('set-cookie')).toBe(
      `${PREVIEW_COOKIE}=${KEY}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    );
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
    expect(harness.calls.filter((call) => call.url.includes('/__preview/'))).toEqual([]);
  });

  test('forwards a page to the machine’s tunnel with the key in a header and without its own cookie', async () => {
    const harness = createHarness();
    const { credentials, origin } = await shareMachine(harness);
    harness.handlers.push((upstream) =>
      upstream.url.includes('/__preview/')
        ? new Response('<p>hello</p>', {
            status: 200,
            headers: { 'content-type': 'text/html', 'set-cookie': 'a=1' },
          })
        : new Response(null, { status: 599 })
    );
    const answer = await visit(
      harness,
      `${origin}/app/page?x=1`,
      withKey(
        { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4', accept: 'text/html' } },
        '; theme=dark'
      )
    );
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('<p>hello</p>');
    expect(answer.headers.get('set-cookie')).toBe('a=1');
    expect(answer.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    const call = harness.calls.at(-1);
    expect(call?.url).toBe(`https://${credentials.tunnelHost}/__preview/${PREVIEW_ID}/app/page?x=1`);
    expect(call?.headers.get(PREVIEW_KEY_HEADER)).toBe(KEY);
    expect(call?.headers.get('cookie')).toBe('theme=dark');
    expect(call?.headers.get('accept')).toBe('text/html');
    expect(call?.headers.has('cf-connecting-ip')).toBe(false);
    expect(call?.headers.has('x-forwarded-for')).toBe(false);
  });

  test('sends a form’s body on, and hands a socket upgrade back untouched', async () => {
    const harness = createHarness();
    const { origin } = await shareMachine(harness);
    const upgrade = new Response(null, { status: 200 });
    Object.defineProperty(upgrade, 'status', { value: 101 });
    harness.handlers.push((call) => {
      if (!call.url.includes('/__preview/')) return new Response(null, { status: 599 });
      return call.headers.get('upgrade') === 'websocket' ? upgrade : new Response(`got ${call.body}`);
    });
    const posted = await visit(harness, `${origin}/save`, withKey({ method: 'POST', body: 'a=1' }));
    expect(await posted.text()).toBe('got a=1');
    const socket = await visit(
      harness,
      `${origin}/@vite/hmr`,
      withKey({ headers: { upgrade: 'websocket' } })
    );
    expect(socket).toBe(upgrade);
  });

  test('without a key, with a wrong one or for a machine that is gone, says the preview is no longer shared', async () => {
    const harness = createHarness();
    const { origin } = await shareMachine(harness);
    const missing = await visit(harness, `${origin}/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain(PREVIEW_GONE);
    expect((await visit(harness, `${origin}/?key=short`)).status).toBe(404);
    expect(
      (await visit(harness, `${origin}/`, { headers: { cookie: `${PREVIEW_COOKIE}=nope` } })).status
    ).toBe(404);
    const gone = resolvePreviewOrigin({ instanceId: 'missing', previewId: PREVIEW_ID });
    expect((await visit(harness, `${gone}/`, withKey())).status).toBe(404);
    const apex = await visit(harness, 'https://shinsa.page/');
    expect(apex.status).toBe(404);
    expect(apex.headers.get('cache-control')).toBe('no-store');
  });

  test('says the machine is offline when it stopped beating, the tunnel fails or does not answer', async () => {
    const harness = createHarness();
    const { origin } = await shareMachine(harness);
    harness.handlers.push((call) => {
      if (call.url.endsWith('/down')) return new Response('bad gateway', { status: 530 });
      if (call.url.endsWith('/throw')) throw new Error('no route');
      return new Response(null, { status: 599 });
    });
    const down = await visit(harness, `${origin}/down`, withKey());
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('30');
    expect(await down.text()).toContain('offline');
    expect((await visit(harness, `${origin}/throw`, withKey())).status).toBe(503);
    harness.clock.now += 10 * 60 * 1000;
    const stale = await visit(harness, `${origin}/`, withKey());
    expect(stale.status).toBe(503);
    expect(await stale.text()).toContain(PREVIEW_OFFLINE.slice(0, 40));
  });

  test('answers a failure inside the Worker as an error, not the app', async () => {
    const harness = createHarness();
    const { origin } = await shareMachine(harness);
    harness.world.store.selectInstance = () => Promise.reject(new Error('d1 down'));
    const answer = await visit(harness, `${origin}/`, withKey());
    expect(answer.status).toBe(500);
  });

  test('passes on every cookie but its own', () => {
    expect(resolveForwardCookie(null)).toBeNull();
    expect(resolveForwardCookie(`${PREVIEW_COOKIE}=x`)).toBeNull();
    expect(resolveForwardCookie(`a=1; ${PREVIEW_COOKIE}=x;b=2`)).toBe('a=1; b=2');
  });
});
