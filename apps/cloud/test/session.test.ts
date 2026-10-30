import { describe, expect, test } from 'bun:test';
import type { RemoteSession } from '@shinsa/core';
import { createHarness, readJson } from './harness.ts';

describe('signing in with GitHub', () => {
  test('sends you to GitHub with a state, and back to where you were with a session', async () => {
    const harness = createHarness();
    const start = await harness.call('/app/__remote/sign-in?return=/app/pair?code=ABCD');
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://shinsa.dev/app/__remote/sign-in/callback'
    );
    expect(start.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
    const session = await harness.signIn('mona', 42);
    expect(session.length).toBeGreaterThan(20);
    const answer = await readJson<RemoteSession>(await harness.call('/app/__remote/session', { session }));
    expect(answer.user).toEqual({ id: '42', login: 'mona', avatarUrl: null });
  });

  test('stores only a hash of the session token', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const rows = harness.db.sqlite.query('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(session);
  });

  test('keeps the return path on this site', async () => {
    const harness = createHarness();
    for (const unsafe of ['//evil.dev', 'https://evil.dev', '/\\evil.dev']) {
      const start = await harness.call(`/app/__remote/sign-in?return=${encodeURIComponent(unsafe)}`);
      expect(start.headers.get('set-cookie')).toMatch(/^__Secure-shinsa_oauth=[\w-]+\.%2Fapp%2F;/);
    }
  });

  test('refuses a callback whose state does not match, and says so on the page', async () => {
    const harness = createHarness();
    const done = await harness.call('/app/__remote/sign-in/callback?code=x&state=forged', {
      headers: { cookie: '__Secure-shinsa_oauth=real./' },
    });
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('/app/?sign_in_error=sign_in_failed');
    const missing = await harness.call('/app/__remote/sign-in/callback?code=x&state=forged');
    expect(missing.headers.get('location')).toBe('/app/?sign_in_error=sign_in_failed');
  });

  test('refuses when GitHub refuses the code or does not say who you are', async () => {
    const harness = createHarness();
    harness.handlers.push((call) =>
      call.url.includes('access_token')
        ? new Response('not json', { status: 400 })
        : new Response('', { status: 599 })
    );
    const start = await harness.call('/app/__remote/sign-in');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const refused = await harness.call(`/app/__remote/sign-in/callback?code=x&state=${state}`, {
      headers: { cookie },
    });
    expect(refused.headers.get('location')).toBe('/app/?sign_in_error=sign_in_failed');
    harness.handlers.length = 0;
    const unknown = await harness.call(`/app/__remote/sign-in/callback?code=nobody&state=${state}`, {
      headers: { cookie },
    });
    expect(unknown.headers.get('location')).toBe('/app/?sign_in_error=sign_in_failed');
  });

  test('lets in only the GitHub accounts on the list', async () => {
    const harness = createHarness({ allowedLogins: ['mona'] });
    expect(await harness.signIn('Mona', 1)).not.toBe('');
    expect(await harness.signIn('kai', 2)).toBe('');
    const rows = harness.db.sqlite.query('SELECT login FROM users').all() as { login: string }[];
    expect(rows.map((row) => row.login)).toEqual(['Mona']);
  });

  test('lets nobody in while the list is empty, so a deploy without it is closed', async () => {
    const harness = createHarness({ allowedLogins: [] });
    expect(await harness.signIn('mona', 1)).toBe('');
    expect(harness.db.sqlite.query('SELECT login FROM users').all()).toEqual([]);
  });

  test('says nobody is signed in without a session or with an expired one', async () => {
    const harness = createHarness();
    expect(await readJson<RemoteSession>(await harness.call('/app/__remote/session'))).toEqual({
      user: null,
    });
    const session = await harness.signIn();
    harness.clock.now += 31 * 24 * 60 * 60 * 1000;
    expect(await readJson<RemoteSession>(await harness.call('/app/__remote/session', { session }))).toEqual({
      user: null,
    });
  });

  test('signs out only from this site, and forgets the session', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const crossSite = await harness.post('/app/__remote/sign-out', {}, { session, sameOrigin: false });
    expect(crossSite.status).toBe(403);
    const out = await harness.post('/app/__remote/sign-out', {}, { session });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await readJson<RemoteSession>(await harness.call('/app/__remote/session', { session }))).toEqual({
      user: null,
    });
    expect((await harness.post('/app/__remote/sign-out', {})).status).toBe(200);
  });
});
