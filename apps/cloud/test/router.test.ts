import { describe, expect, spyOn, test } from 'bun:test';
import { REMOTE_PATHS } from '@shinsa/core';
import { readCookie } from '../src/http.ts';
import { resolveCloudConfig } from '../src/world.ts';
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

describe('the helpers', () => {
  test('reads one cookie among many', () => {
    const request = new Request('https://x', { headers: { cookie: 'a=1; b=two=2' } });
    expect(readCookie(request, 'b')).toBe('two=2');
    expect(readCookie(request, 'c')).toBeNull();
  });

  test('reads the Worker’s settings with defaults', () => {
    expect(resolveCloudConfig({})).toEqual({
      origin: 'https://app.shinsa.dev',
      githubClientId: '',
      githubClientSecret: '',
      cloudflareAccountId: '',
      cloudflareApiToken: '',
      tunnelZone: 'shinsa.dev',
      previewOrigin: 'https://shinsa.page',
      maxInstances: 50,
      slackClientId: '',
      slackClientSecret: '',
      slackSigningSecret: '',
      slackTokenKey: '',
    });
    expect(
      resolveCloudConfig({
        APP_ORIGIN: 'http://localhost:5183',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_API_TOKEN: 'token',
        TUNNEL_ZONE: 'example.dev',
        PREVIEW_ZONE: 'example.page',
        MAX_INSTANCES: '3',
        SLACK_CLIENT_ID: 'slack-id',
        SLACK_CLIENT_SECRET: 'slack-secret',
        SLACK_SIGNING_SECRET: 'signing',
        SLACK_TOKEN_KEY: 'key',
      })
    ).toEqual({
      origin: 'http://localhost:5183',
      githubClientId: 'id',
      githubClientSecret: 'secret',
      cloudflareAccountId: 'account',
      cloudflareApiToken: 'token',
      tunnelZone: 'example.dev',
      previewOrigin: 'https://example.page',
      maxInstances: 3,
      slackClientId: 'slack-id',
      slackClientSecret: 'slack-secret',
      slackSigningSecret: 'signing',
      slackTokenKey: 'key',
    });
  });
});
