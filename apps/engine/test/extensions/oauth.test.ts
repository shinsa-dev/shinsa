import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpOAuth } from '../../src/extensions/oauth.ts';
import { SecretStore } from '../../src/secrets/store.ts';
import { type FakeMcpHttp, startFakeMcpHttp } from '../helpers/mcp/http.ts';

const REDIRECT = 'http://127.0.0.1:5180/api/mcp/oauth/callback';

let fake: FakeMcpHttp | null = null;

afterEach(async () => {
  await fake?.stop();
  fake = null;
});

function createStore() {
  return new SecretStore(join(mkdtempSync(join(tmpdir(), 'shinsa-oauth-')), 'secrets.json'));
}

async function followAuthorization(authorizationUrl: string) {
  const response = await fetch(authorizationUrl, { redirect: 'manual' });
  const callback = new URL(response.headers.get('location') ?? '');
  return { state: callback.searchParams.get('state') ?? '', code: callback.searchParams.get('code') ?? '' };
}

describe('signing in to a remote MCP server', () => {
  test('registers Shinsa, sends you to the server with PKCE, and keeps the tokens in the secret store', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => REDIRECT });
    expect(oauth.isSignedIn('shinsa:docs')).toBe(false);

    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    expect(authorizationUrl).toContain(`${fake.url}/authorize`);
    const asked = new URL(authorizationUrl ?? '');
    expect(asked.searchParams.get('code_challenge_method')).toBe('S256');
    expect(asked.searchParams.get('redirect_uri')).toBe(REDIRECT);

    const { state, code } = await followAuthorization(authorizationUrl ?? '');
    expect(await oauth.finish(state, code)).toBe('shinsa:docs');
    expect(oauth.isSignedIn('shinsa:docs')).toBe(true);
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBe('access-1');
    expect(store.selectMcpCredentials('shinsa:docs').tokens).toMatchObject({ access_token: 'access-1' });
  });

  test('a sign-in nobody started here, or one used twice, is refused', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const oauth = new McpOAuth(createStore(), { redirectUrl: () => REDIRECT });
    await expect(oauth.finish('unknown-state', 'code-1')).rejects.toThrow('expired or was not started here');
    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    const { state, code } = await followAuthorization(authorizationUrl ?? '');
    await oauth.finish(state, code);
    await expect(oauth.finish(state, code)).rejects.toThrow('expired or was not started here');
  });

  test('a sign-in left open past its ten minutes expires', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    let now = 1_000;
    const oauth = new McpOAuth(createStore(), { redirectUrl: () => REDIRECT, now: () => now, pendingMs: 50 });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    now += 51;
    await expect(oauth.finish(state, code)).rejects.toThrow('expired');
  });

  test('a code the server refuses fails the sign-in', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const oauth = new McpOAuth(createStore(), { redirectUrl: () => REDIRECT });
    const { state } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await expect(oauth.finish(state, 'forged')).rejects.toThrow();
    expect(oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('a server that no longer knows Shinsa as a client forgets every saved credential', async () => {
    fake = startFakeMcpHttp({ oauth: true, tokenError: 'invalid_client' });
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await expect(oauth.finish(state, code)).rejects.toThrow();
    expect(store.selectMcpCredentials('shinsa:docs')).not.toHaveProperty('client');
    expect(oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('an access token about to expire is refreshed before an agent gets it', async () => {
    fake = startFakeMcpHttp({ oauth: true, expiresIn: 30 });
    const oauth = new McpOAuth(createStore(), { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBe('access-2');
    expect(fake.refreshed).toBe(1);
  });

  test('a refresh the server refuses signs the server out, so it asks you to connect again', async () => {
    fake = startFakeMcpHttp({ oauth: true, expiresIn: 30 });
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    store.updateMcpCredentials('shinsa:docs', {
      tokens: { access_token: 'access-1', refresh_token: 'stale', token_type: 'Bearer', expires_in: 30 },
    });
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBeNull();
    expect(oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('an unreachable server makes the refresh fail without throwing', async () => {
    const store = createStore();
    store.updateMcpCredentials('shinsa:docs', {
      tokens: { access_token: 'old', refresh_token: 'r', token_type: 'Bearer', expires_in: 1 },
      savedAt: 1,
    });
    const oauth = new McpOAuth(store, {
      redirectUrl: () => REDIRECT,
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await oauth.resolveAccessToken('shinsa:docs', 'http://127.0.0.1:9/mcp')).toBe('old');
  });

  test('no token, no access token; signing out forgets everything', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => REDIRECT });
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBeNull();
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    oauth.signOut('shinsa:docs');
    expect(oauth.isSignedIn('shinsa:docs')).toBe(false);
    expect(store.selectMcpCredentials('shinsa:docs')).toEqual({});
  });

  test('a server that needs no sign-in is authorized at once, with no page to open', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    expect(await oauth.start('shinsa:docs', fake.mcpUrl)).toBeNull();
  });

  test('a new redirect address registers Shinsa again instead of reusing the old client', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    let redirect = REDIRECT;
    const store = createStore();
    const oauth = new McpOAuth(store, { redirectUrl: () => redirect });
    await oauth.start('shinsa:docs', fake.mcpUrl);
    redirect = 'http://127.0.0.1:5300/api/mcp/oauth/callback';
    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    expect(new URL(authorizationUrl ?? '').searchParams.get('redirect_uri')).toBe(redirect);
    expect(store.selectMcpCredentials('shinsa:docs').clientRedirect).toBe(redirect);
  });
});
