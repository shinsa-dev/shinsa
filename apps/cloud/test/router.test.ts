import { describe, expect, spyOn, test } from 'bun:test';
import { REMOTE_PATHS } from '@shinsa/core';
import { createHarness } from './harness.ts';

describe('the router', () => {
  test('serves the web app with a strict content security policy', async () => {
    const harness = createHarness();
    const page = await harness.call('/tasks/LOC-1');
    expect(await page.text()).toBe('asset /tasks/LOC-1');
    const policy = page.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self' blob: wss://*.shinsa.dev");
    expect(policy).toContain("media-src 'self' blob:");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('strict-transport-security')).toContain('max-age=');
  });

  test('refuses anything but GET outside the API and webhooks', async () => {
    const harness = createHarness();
    expect((await harness.call('/tasks', { method: 'POST' })).status).toBe(405);
  });

  test('answers 404 for an unknown endpoint or method under the API', async () => {
    const harness = createHarness();
    expect((await harness.call('/__remote/nothing')).status).toBe(404);
    expect((await harness.call(REMOTE_PATHS.session, { method: 'POST' })).status).toBe(404);
  });

  test('answers 404 for an id in the path that is not one, after the session is checked', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const malformed = await harness.call('/__remote/instances/not.an.id/connect', {
      method: 'POST',
      session,
      sameOrigin: true,
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
    const signedOut = await harness.call('/__remote/instances/not.an.id/connect', {
      method: 'POST',
      sameOrigin: true,
    });
    expect(signedOut.status).toBe(401);
  });

  test('names the field a body gets wrong', async () => {
    const harness = createHarness();
    const missing = await harness.post(REMOTE_PATHS.pairStart, { name: 'Studio', version: '1' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: 'body_invalid', message: expect.stringContaining('The field publicKey is not valid') },
    });
  });

  test('refuses a body that is not JSON, too large, or not an object', async () => {
    const harness = createHarness();
    const text = await harness.call(REMOTE_PATHS.pairStart, { method: 'POST', body: 'x' });
    expect(text.status).toBe(415);
    const send = (body: string) =>
      harness.call(REMOTE_PATHS.pairStart, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    expect((await send('{')).status).toBe(400);
    expect((await send('[]')).status).toBe(400);
    expect((await send(JSON.stringify({ name: 'x'.repeat(20_000) }))).status).toBe(413);
  });

  test('hides an unexpected failure behind a plain message and logs it', async () => {
    const harness = createHarness();
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    harness.db.sqlite.exec('DROP TABLE sessions');
    const failed = await harness.call(REMOTE_PATHS.session, {
      headers: { cookie: '__Host-shinsa_session=x' },
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: { code: 'server_error', message: 'Something went wrong on app.shinsa.dev. Try again.' },
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  test('a webhook that fails unexpectedly is a plain 500 too', async () => {
    const harness = createHarness();
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    harness.db.sqlite.exec('DROP TABLE instances');
    expect((await harness.call('/hooks/a/b/c', { method: 'POST', body: 'x' })).status).toBe(500);
    logged.mockRestore();
  });
});
