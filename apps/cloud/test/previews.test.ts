import { describe, expect, spyOn, test } from 'bun:test';
import {
  createPreviewAccessToken,
  type InviteCreateResponse,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_ACCESS_TTL_MS,
  PREVIEW_GONE,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  PREVIEW_OFFLINE,
  PREVIEW_OPEN_TTL_MS,
  PREVIEW_PAGE_HEADER,
  PREVIEW_STOPPED,
  REMOTE_PATHS,
  resolvePreviewOrigin,
  serializeBase64Url,
  serializePreviewUrl,
  verifyPreviewAccessToken,
} from '@shinsa/core';
import { PREVIEW_ACCESS_COOKIE, PREVIEW_COOKIE, resolveForwardCookie } from '../src/previews.ts';
import { respond } from '../src/router.ts';
import { createHarness, type Harness, heartbeat, pairMachine, readJson } from './harness.ts';

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
    expect(answer.headers.get('location')).toBe(`${new URL(link).origin}/docs/start?tab=2`);
    expect(answer.headers.get('set-cookie')).toBe(
      `${PREVIEW_COOKIE}=${KEY}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    );
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
    expect(harness.calls.filter((call) => call.url.includes('/__preview/'))).toEqual([]);
  });

  test('redirects on the same host even when the path starts with two slashes', async () => {
    const harness = createHarness();
    const { link } = await shareMachine(harness);
    const answer = await visit(harness, link.replace('/?', '//evil.example/?'));
    const location = new URL(answer.headers.get('location') ?? '', 'https://elsewhere.test');
    expect(location.origin).toBe(new URL(link).origin);
    expect(location.pathname).toBe('//evil.example/');
  });

  test('forwards a page to the machine’s tunnel with the key in a header and without its own cookie', async () => {
    const harness = createHarness();
    const { credentials, origin } = await shareMachine(harness);
    harness.handlers.push((upstream) =>
      upstream.url.includes('/__preview/')
        ? new Response('<p>hello</p>', {
            status: 200,
            headers: [
              ['content-type', 'text/html'],
              ['set-cookie', 'a=1'],
              ['set-cookie', 'b=2; Path=/; Domain=shinsa.page; Secure'],
              ['set-cookie', 'domain=foo; Path=/'],
            ],
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
    expect(answer.headers.getSetCookie()).toEqual(['a=1', 'b=2; Path=/; Secure', 'domain=foo; Path=/']);
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
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
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
    expect(logged.mock.calls.map(([message]) => message)).toEqual([
      '[Preview] The tunnel did not answer',
      '[Preview] Could not reach the tunnel',
    ]);
    harness.clock.now += 10 * 60 * 1000;
    const stale = await visit(harness, `${origin}/`, withKey());
    expect(stale.status).toBe(503);
    expect(await stale.text()).toContain(PREVIEW_OFFLINE.slice(0, 40));
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  test('passes on the machine’s own page for a stopped service, not the offline page', async () => {
    const harness = createHarness();
    const { origin } = await shareMachine(harness);
    harness.handlers.push(
      () => new Response(PREVIEW_STOPPED, { status: 503, headers: { [PREVIEW_PAGE_HEADER]: '1' } })
    );
    const stopped = await visit(harness, `${origin}/`, withKey());
    expect(stopped.status).toBe(503);
    expect(stopped.headers.has(PREVIEW_PAGE_HEADER)).toBe(false);
    expect(await stopped.text()).toBe(PREVIEW_STOPPED);
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
    expect(resolveForwardCookie(`${PREVIEW_ACCESS_COOKIE}=t; a=1`)).toBe('a=1');
  });
});

async function pairPrivate(harness: Harness) {
  const mona = await harness.signIn('mona', 1);
  const credentials = await pairMachine(harness, mona);
  await heartbeat(harness, credentials);
  const address = { instanceId: credentials.instanceId, previewId: PREVIEW_ID };
  return { mona, credentials, address, origin: resolvePreviewOrigin(address) };
}

function openPath(url: string) {
  return `${REMOTE_PATHS.previewOpen}?url=${encodeURIComponent(url)}`;
}

function withAccess(token: string, init: RequestInit = {}) {
  return { ...init, headers: { cookie: `${PREVIEW_ACCESS_COOKIE}=${token}; theme=dark`, ...init.headers } };
}

describe('a private address', () => {
  test('opens for the machine’s owner with a short token the machine can check, keeping the path', async () => {
    const harness = createHarness();
    const { mona, credentials, address, origin } = await pairPrivate(harness);
    const answer = await harness.call(openPath(`${origin}/docs?tab=2&key=old#top`), { session: mona });
    expect(answer.status).toBe(303);
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
    const location = new URL(answer.headers.get('location') ?? '');
    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe('/docs');
    expect(location.hash).toBe('#top');
    expect(location.searchParams.get('tab')).toBe('2');
    expect(location.searchParams.has('key')).toBe(false);
    const token = location.searchParams.get('access') ?? '';
    const claim = await verifyPreviewAccessToken(
      credentials.connectKey,
      token,
      address,
      harness.clock.now,
      PREVIEW_OPEN_TTL_MS
    );
    expect(claim?.userId).toBe('1');
    expect(claim?.expiresAt).toBe(harness.clock.now + PREVIEW_OPEN_TTL_MS);
  });

  test('sends someone signed out to sign in first, and comes back to the same address', async () => {
    const harness = createHarness();
    const { origin } = await pairPrivate(harness);
    const path = openPath(`${origin}/`);
    const answer = await harness.call(path);
    expect(answer.status).toBe(302);
    const signIn = new URL(answer.headers.get('location') ?? '');
    expect(signIn.pathname).toBe(REMOTE_PATHS.signIn);
    expect(signIn.searchParams.get('return')).toBe(path);
  });

  test('opens for a member, never for an account the machine was not shared with', async () => {
    const harness = createHarness();
    const { credentials, origin } = await pairPrivate(harness);
    const kai = await harness.signIn('kai', 2);
    expect((await harness.call(openPath(`${origin}/`), { session: kai })).status).toBe(404);
    const machine = { bearer: credentials.machineToken, sameOrigin: false };
    const invite = await readJson<InviteCreateResponse>(
      await harness.post(REMOTE_PATHS.machineInvites, {}, machine)
    );
    await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token }, { session: kai });
    await harness.post(REMOTE_PATHS.machineMemberAdd, { userId: '2' }, machine);
    expect((await harness.call(openPath(`${origin}/`), { session: kai })).status).toBe(303);
  });

  test('refuses an address that is not a preview, so it can never redirect elsewhere', async () => {
    const harness = createHarness();
    const { mona } = await pairPrivate(harness);
    for (const url of ['https://evil.example/', 'http://x.shinsa.page/', 'not a url'])
      expect((await harness.call(openPath(url), { session: mona })).status).toBe(400);
    expect((await harness.call(REMOTE_PATHS.previewOpen, { session: mona })).status).toBe(400);
  });

  test('trades a valid short token for a 12-hour cookie on that host and drops it from the address', async () => {
    const harness = createHarness();
    const { credentials, address, origin } = await pairPrivate(harness);
    const short = await createPreviewAccessToken(credentials.connectKey, {
      ...address,
      userId: '1',
      expiresAt: harness.clock.now + PREVIEW_OPEN_TTL_MS,
    });
    const answer = await visit(harness, `${origin}/app?access=${short}&x=1`);
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe(`${origin}/app?x=1`);
    const cookie = answer.headers.get('set-cookie') ?? '';
    expect(cookie).toEndWith('; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax');
    const token = cookie.split(';')[0]?.slice(`${PREVIEW_ACCESS_COOKIE}=`.length) ?? '';
    const claim = await verifyPreviewAccessToken(credentials.connectKey, token, address, harness.clock.now);
    expect(claim?.expiresAt).toBe(harness.clock.now + PREVIEW_ACCESS_TTL_MS);
    expect(harness.calls.filter((call) => call.url.includes('/__preview/'))).toEqual([]);
  });

  test('turns away a forged, expired, long-lived or misplaced token', async () => {
    const harness = createHarness();
    const { credentials, address, origin } = await pairPrivate(harness);
    const sign = (expiresAt: number, at = address) =>
      createPreviewAccessToken(credentials.connectKey, { ...at, userId: '1', expiresAt });
    const now = harness.clock.now;
    const other = { ...address, previewId: serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(3)) };
    for (const token of [
      'forged',
      await sign(now),
      await sign(now + PREVIEW_ACCESS_TTL_MS),
      await sign(now + 1, other),
    ])
      expect((await visit(harness, `${origin}/?access=${encodeURIComponent(token)}`)).status).toBe(404);
    const gone = resolvePreviewOrigin({ instanceId: 'missing', previewId: PREVIEW_ID });
    expect((await visit(harness, `${gone}/?access=${await sign(now + 1)}`)).status).toBe(404);
  });

  test('forwards with the access cookie as a header, never the client’s own pass headers', async () => {
    const harness = createHarness();
    const { credentials, origin } = await pairPrivate(harness);
    harness.handlers.push((call) =>
      call.url.includes('/__preview/') ? new Response('ok') : new Response(null, { status: 599 })
    );
    const forged = { [PREVIEW_ACCESS_HEADER]: 'forged', [PREVIEW_KEY_HEADER]: 'forged' };
    await visit(harness, `${origin}/page`, withAccess('signed', { headers: forged }));
    const sent = harness.calls.at(-1);
    expect(sent?.url).toBe(`https://${credentials.tunnelHost}/__preview/${PREVIEW_ID}/page`);
    expect(sent?.headers.get(PREVIEW_ACCESS_HEADER)).toBe('signed');
    expect(sent?.headers.has(PREVIEW_KEY_HEADER)).toBe(false);
    expect(sent?.headers.get('cookie')).toBe('theme=dark');
    await visit(harness, `${origin}/page`, withKey({ headers: forged }));
    expect(harness.calls.at(-1)?.headers.has(PREVIEW_ACCESS_HEADER)).toBe(false);
    expect(harness.calls.at(-1)?.headers.get(PREVIEW_KEY_HEADER)).toBe(KEY);
  });
});
