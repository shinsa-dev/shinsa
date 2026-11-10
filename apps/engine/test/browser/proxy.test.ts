import { afterEach, describe, expect, test } from 'bun:test';
import { Effect, Exit, Layer, Scope } from 'effect';
import { BrowserUnavailable } from '../../src/browser/host/schema.ts';
import { BrowserHost } from '../../src/browser/host/service.ts';
import {
  isLoopbackAddress,
  readBrowserKey,
  resolveBrowserEndpoint,
  resolveRefusedReply,
} from '../../src/browser/proxy/endpoint.ts';
import {
  BROWSER_GONE_REASON,
  KEY_REFUSED_MESSAGE,
  KEY_REVOKED_REASON,
  REFUSED_METHOD_MESSAGE,
} from '../../src/browser/proxy/schema.ts';
import { BrowserProxy } from '../../src/browser/proxy/service.ts';
import { ServerAddress } from '../../src/serve/address/service.ts';
import { until } from '../helpers/until.ts';
import { createFakePeer, type FakeCdp, startFakeCdp } from './cdp.ts';
import { SHINSA, SUPERWALL } from './harness.ts';

interface Leases {
  acquired: string[];
  released: string[];
}

const servers: FakeCdp[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

function runProxy<A, E>(
  effect: Effect.Effect<A, E, BrowserProxy | Scope.Scope>,
  options: { unavailable?: boolean } = {}
) {
  const cdp = startFakeCdp();
  servers.push(cdp);
  const leases: Leases = { acquired: [], released: [] };
  const host = Layer.succeed(BrowserHost, {
    acquire: (profile) =>
      options.unavailable
        ? Effect.fail(new BrowserUnavailable({ reason: 'signing_in', message: 'Signing in.' }))
        : Effect.acquireRelease(
            Effect.sync(() => {
              leases.acquired.push(profile);
              return { webSocketUrl: cdp.url };
            }),
            () => Effect.sync(() => leases.released.push(profile))
          ),
    openWindow: () => Effect.void,
    closeWindow: () => Effect.void,
    stop: () => Effect.void,
    remove: () => Effect.void,
    resolveMode: () => Effect.succeed('stopped' as const),
    resolveProfilePath: (profile) => profile,
  });
  const address = Layer.succeed(ServerAddress, {
    url: Effect.succeed('http://127.0.0.1:7446'),
    current: () => 'http://127.0.0.1:7446',
    replace: () => Effect.void,
  });
  const layer = BrowserProxy.layer.pipe(Layer.provide(Layer.merge(host, address)));
  return {
    cdp,
    leases,
    result: Effect.runPromise(Effect.scoped(Effect.provide(effect, layer))),
  };
}

function readKey(endpoint: string) {
  return readBrowserKey(new URL(endpoint).pathname) ?? '';
}

describe('the browser endpoint', () => {
  test('points at the engine over WebSocket with the key in the path', () => {
    expect(resolveBrowserEndpoint('http://127.0.0.1:7446/', 'abc')).toBe(
      'ws://127.0.0.1:7446/browser/cdp/abc'
    );
    expect(resolveBrowserEndpoint('https://mac.local:7446', 'abc')).toBe(
      'wss://mac.local:7446/browser/cdp/abc'
    );
    expect(readBrowserKey('/browser/cdp/abc')).toBe('abc');
    expect(readBrowserKey('/ws')).toBeNull();
  });

  test('counts only this machine as local', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.4')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
  });

  test('answers a command that would close the shared browser instead of passing it on', () => {
    const reply = resolveRefusedReply(JSON.stringify({ id: 4, method: 'Browser.close' }));
    expect(JSON.parse(reply ?? '')).toEqual({
      id: 4,
      error: { code: -32000, message: REFUSED_METHOD_MESSAGE },
    });
    const inSession = resolveRefusedReply(JSON.stringify({ id: 5, method: 'Browser.crash', sessionId: 's' }));
    expect(JSON.parse(inSession ?? '')).toMatchObject({ id: 5, sessionId: 's' });
    expect(resolveRefusedReply(JSON.stringify({ id: 6, method: 'Browser.getVersion' }))).toBeNull();
    expect(resolveRefusedReply(JSON.stringify({ id: 7, method: 'Page.navigate' }))).toBeNull();
    expect(resolveRefusedReply('{"Browser.close" is not json')).toBeNull();
  });
});

describe('the browser proxy', () => {
  test('issues a key per run that reaches its project’s browser only while the run lasts', async () => {
    const { leases, result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const run = yield* Scope.make();
        const endpoint = yield* proxy.issue(SHINSA).pipe(Scope.provide(run));
        const admission = yield* proxy.admit(readKey(endpoint));
        yield* proxy.dismiss(admission);
        yield* Scope.close(run, Exit.void);
        const after = yield* Effect.flip(proxy.admit(readKey(endpoint)));
        const unknown = yield* Effect.flip(proxy.admit('not-a-key'));
        return { endpoint, admission, after, unknown };
      })
    );
    const { endpoint, admission, after, unknown } = await result;
    expect(endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:7446\/browser\/cdp\/[A-Za-z0-9_-]{43}$/);
    expect(admission.profile).toBe(SHINSA);
    expect(leases).toEqual({ acquired: [SHINSA], released: [SHINSA] });
    expect(after).toMatchObject({ _tag: 'BrowserKeyRefused', message: KEY_REFUSED_MESSAGE });
    expect(unknown._tag).toBe('BrowserKeyRefused');
  });

  test('gives each project its own key', async () => {
    const { result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const shinsa = yield* proxy.admit(readKey(yield* proxy.issue(SHINSA)));
        const superwall = yield* proxy.admit(readKey(yield* proxy.issue(SUPERWALL)));
        return [shinsa.profile, superwall.profile];
      })
    );
    expect(await result).toEqual([SHINSA, SUPERWALL]);
  });

  test('passes on why the browser cannot be reached and holds no lease', async () => {
    const { leases, result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        return yield* Effect.flip(proxy.admit(readKey(yield* proxy.issue(SHINSA))));
      }),
      { unavailable: true }
    );
    expect(await result).toMatchObject({ _tag: 'BrowserUnavailable', reason: 'signing_in' });
    expect(leases.acquired).toEqual([]);
  });

  test('relays the agent’s commands to Chrome and keeps the browser open for the others', async () => {
    const peer = createFakePeer();
    const { cdp, leases, result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const admission = yield* proxy.admit(readKey(yield* proxy.issue(SHINSA)));
        const relay = yield* proxy.open(peer, admission);
        relay.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
        relay.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
        yield* Effect.promise(() => until('both answers', () => peer.messages.length >= 2));
        relay.send(JSON.stringify({ id: 3, method: 'Target.createTarget' }));
        relay.send(new TextEncoder().encode(JSON.stringify({ id: 4, method: 'Runtime.enable' })));
        yield* Effect.promise(() => until('the later answers', () => peer.messages.length >= 4));
        relay.close();
        relay.close();
      })
    );
    await result;
    expect(cdp.received.map((text) => JSON.parse(text).method)).toEqual([
      'Target.getTargets',
      'Target.createTarget',
      'Runtime.enable',
    ]);
    expect(peer.messages.map((text) => JSON.parse(text).id).sort()).toEqual([1, 2, 3, 4]);
    expect(peer.messages.find((text) => JSON.parse(text).id === 2)).toContain(REFUSED_METHOD_MESSAGE);
    expect(peer.closed).toEqual([]);
    expect(leases.released).toEqual([SHINSA]);
  });

  test('closes the agent’s connection when its run ends', async () => {
    const peer = createFakePeer();
    const { leases, result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const run = yield* Scope.make();
        const admission = yield* proxy.admit(readKey(yield* proxy.issue(SHINSA).pipe(Scope.provide(run))));
        yield* proxy.open(peer, admission);
        yield* Scope.close(run, Exit.void);
      })
    );
    await result;
    expect(peer.closed).toEqual([{ code: 1008, reason: KEY_REVOKED_REASON }]);
    expect(leases.released).toEqual([SHINSA]);
  });

  test('refuses a connection whose run ended before it opened', async () => {
    const peer = createFakePeer();
    const { result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const run = yield* Scope.make();
        const admission = yield* proxy.admit(readKey(yield* proxy.issue(SHINSA).pipe(Scope.provide(run))));
        yield* Scope.close(run, Exit.void);
        yield* proxy.open(peer, admission);
      })
    );
    await result;
    expect(peer.closed).toEqual([{ code: 1008, reason: KEY_REVOKED_REASON }]);
  });

  test('tells the agent when Chrome goes away', async () => {
    const peer = createFakePeer();
    const { cdp, leases, result } = runProxy(
      Effect.gen(function* () {
        const proxy = yield* BrowserProxy;
        const admission = yield* proxy.admit(readKey(yield* proxy.issue(SHINSA)));
        const relay = yield* proxy.open(peer, admission);
        relay.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
        yield* Effect.promise(() => until('the answer', () => peer.messages.length > 0));
        cdp.dropAll();
        yield* Effect.promise(() => until('the connection to close', () => peer.closed.length > 0));
        relay.send(JSON.stringify({ id: 2, method: 'Target.getTargets' }));
      })
    );
    await result;
    expect(peer.closed).toEqual([{ code: 1001, reason: BROWSER_GONE_REASON }]);
    expect(leases.released).toEqual([SHINSA]);
  });
});
