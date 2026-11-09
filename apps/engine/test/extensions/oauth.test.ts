import { afterEach, describe, expect, test } from 'bun:test';
import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import type { FetchLike } from '../../src/extensions/oauth/schema.ts';
import { McpOAuth } from '../../src/extensions/oauth/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { SecretFiles } from '../../src/secrets/files/service.ts';
import { SecretStore } from '../../src/secrets/store/service.ts';
import { createFixedClock } from '../helpers/clock.ts';
import { createConfigAt } from '../helpers/config.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { type FakeMcpHttp, startFakeMcpHttp } from '../helpers/mcp/http.ts';
import { createTempDir } from '../helpers/temp.ts';

interface OAuthOptions {
  redirectUrl: () => string;
  now?: () => number;
  fetch?: FetchLike;
}

const runtimes: { dispose: () => Promise<void> }[] = [];

function createStore() {
  const runtime = ManagedRuntime.make(
    SecretStore.layer.pipe(
      Layer.provide(SecretFiles.layer),
      Layer.provideMerge(Layer.succeed(EngineConfig, createConfigAt(createTempDir('shinsa-oauth-')))),
      Layer.provideMerge(JsonFileLayer),
      Layer.provideMerge(JsonLogger)
    )
  );
  runtimes.push(runtime);
  const run = <A, E>(use: (store: SecretStore['Service']) => Effect.Effect<A, E>) =>
    runtime.runPromise(SecretStore.use(use));
  return {
    runtime,
    selectMcpCredentials: (serverId: string) => run((store) => store.selectMcpCredentials(serverId)),
    updateMcpCredentials: (serverId: string, patch: Record<string, unknown>) =>
      run((store) => store.updateMcpCredentials(serverId, patch)),
  };
}

type TestStore = ReturnType<typeof createStore>;

async function openOAuth(store: TestStore, options: OAuthOptions) {
  const secrets = await store.runtime.runPromise(SecretStore.use(Effect.succeed));
  const runtime = ManagedRuntime.make(
    McpOAuth.layer({ redirectUrl: Effect.sync(options.redirectUrl), fetch: options.fetch }).pipe(
      Layer.provide(Layer.succeed(SecretStore, secrets)),
      Layer.provideMerge(
        options.now ? Layer.succeed(Clock.Clock, createFixedClock(options.now)) : Layer.empty
      ),
      Layer.provideMerge(JsonLogger)
    )
  );
  runtimes.push(runtime);
  const run = <A, E>(use: (oauth: McpOAuth['Service']) => Effect.Effect<A, E>) =>
    runtime.runPromise(McpOAuth.use(use));
  return {
    isSignedIn: (serverId: string) => run((oauth) => oauth.isSignedIn(serverId)),
    start: (serverId: string, url: string) => run((oauth) => oauth.start(serverId, url)),
    finish: (state: string, code: string) => run((oauth) => oauth.finish(state, code)),
    resolveAccessToken: (serverId: string, url: string) =>
      run((oauth) => oauth.resolveAccessToken(serverId, url)),
    signOut: (serverId: string) => run((oauth) => oauth.signOut(serverId)),
  };
}

const REDIRECT = 'http://127.0.0.1:5180/api/mcp/oauth/callback';

let fake: FakeMcpHttp | null = null;

afterEach(async () => {
  await fake?.stop();
  fake = null;
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

async function followAuthorization(authorizationUrl: string) {
  const response = await fetch(authorizationUrl, { redirect: 'manual' });
  const callback = new URL(response.headers.get('location') ?? '');
  return { state: callback.searchParams.get('state') ?? '', code: callback.searchParams.get('code') ?? '' };
}

describe('signing in to a remote MCP server', () => {
  test('registers Shinsa, sends you to the server with PKCE, and keeps the tokens in the secret store', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(false);

    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    expect(authorizationUrl).toContain(`${fake.url}/authorize`);
    const asked = new URL(authorizationUrl ?? '');
    expect(asked.searchParams.get('code_challenge_method')).toBe('S256');
    expect(asked.searchParams.get('redirect_uri')).toBe(REDIRECT);

    const { state, code } = await followAuthorization(authorizationUrl ?? '');
    expect(await oauth.finish(state, code)).toBe('shinsa:docs');
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(true);
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBe('access-1');
    expect((await store.selectMcpCredentials('shinsa:docs')).tokens).toMatchObject({
      access_token: 'access-1',
    });
  });

  test('a sign-in nobody started here, or one used twice, is refused', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const oauth = await openOAuth(createStore(), { redirectUrl: () => REDIRECT });
    await expect(oauth.finish('unknown-state', 'code-1')).rejects.toThrow('This sign-in expired.');
    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    const { state, code } = await followAuthorization(authorizationUrl ?? '');
    await oauth.finish(state, code);
    await expect(oauth.finish(state, code)).rejects.toThrow('This sign-in expired.');
  });

  test('a sign-in left open past its ten minutes expires', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    let now = 1_000;
    const oauth = await openOAuth(createStore(), { redirectUrl: () => REDIRECT, now: () => now });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    now += 10 * 60 * 1000 + 1;
    await expect(oauth.finish(state, code)).rejects.toThrow('expired');
  });

  test('a sign-in whose code verifier is gone cannot finish', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await store.updateMcpCredentials('shinsa:docs', { verifier: undefined });
    await expect(oauth.finish(state, code)).rejects.toThrow('The sign-in was not started from this Shinsa.');
  });

  test('a code the server refuses fails the sign-in', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const oauth = await openOAuth(createStore(), { redirectUrl: () => REDIRECT });
    const { state } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await expect(oauth.finish(state, 'forged')).rejects.toThrow();
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('a server that no longer knows Shinsa as a client forgets every saved credential', async () => {
    fake = startFakeMcpHttp({ oauth: true, tokenError: 'invalid_client' });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await expect(oauth.finish(state, code)).rejects.toThrow();
    expect(await store.selectMcpCredentials('shinsa:docs')).not.toHaveProperty('client');
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('an access token about to expire is refreshed before an agent gets it', async () => {
    fake = startFakeMcpHttp({ oauth: true, expiresIn: 30 });
    const oauth = await openOAuth(createStore(), { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBe('access-2');
    expect(fake.refreshed).toBe(1);
  });

  test('a refresh the server refuses signs the server out, so it asks you to connect again', async () => {
    fake = startFakeMcpHttp({ oauth: true, expiresIn: 30 });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    await store.updateMcpCredentials('shinsa:docs', {
      tokens: { access_token: 'access-1', refresh_token: 'stale', token_type: 'Bearer', expires_in: 30 },
    });
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBeNull();
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(false);
  });

  test('an unreachable server makes the refresh fail without throwing', async () => {
    const store = createStore();
    await store.updateMcpCredentials('shinsa:docs', {
      tokens: { access_token: 'old', refresh_token: 'r', token_type: 'Bearer', expires_in: 1 },
      savedAt: 1,
    });
    const oauth = await openOAuth(store, {
      redirectUrl: () => REDIRECT,
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await oauth.resolveAccessToken('shinsa:docs', 'http://127.0.0.1:9/mcp')).toBe('old');
  });

  test('no token, no access token; signing out forgets everything', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    expect(await oauth.resolveAccessToken('shinsa:docs', fake.mcpUrl)).toBeNull();
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    await oauth.signOut('shinsa:docs');
    expect(await oauth.isSignedIn('shinsa:docs')).toBe(false);
    expect(await store.selectMcpCredentials('shinsa:docs')).toEqual({});
  });

  test('a server that needs no sign-in is authorized at once, with no page to open', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => REDIRECT });
    const { state, code } = await followAuthorization((await oauth.start('shinsa:docs', fake.mcpUrl)) ?? '');
    await oauth.finish(state, code);
    expect(await oauth.start('shinsa:docs', fake.mcpUrl)).toBeNull();
  });

  test('a new redirect address registers Shinsa again instead of reusing the old client', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    let redirect = REDIRECT;
    const store = createStore();
    const oauth = await openOAuth(store, { redirectUrl: () => redirect });
    await oauth.start('shinsa:docs', fake.mcpUrl);
    redirect = 'http://127.0.0.1:5300/api/mcp/oauth/callback';
    const authorizationUrl = await oauth.start('shinsa:docs', fake.mcpUrl);
    expect(new URL(authorizationUrl ?? '').searchParams.get('redirect_uri')).toBe(redirect);
    expect((await store.selectMcpCredentials('shinsa:docs')).clientRedirect).toBe(redirect);
  });
});
