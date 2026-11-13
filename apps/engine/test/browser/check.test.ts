import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { type Duration, Effect, Layer } from 'effect';
import { BrowserSignInCheckSettings } from '../../src/browser/check/schema.ts';
import { BrowserSignInCheck } from '../../src/browser/check/service.ts';
import { BrowserUnavailable } from '../../src/browser/host/schema.ts';
import { BrowserHost } from '../../src/browser/host/service.ts';
import { SUPERWALL } from './harness.ts';

const REQUESTED = 'http://localhost:64892/';
const AUTHKIT = 'https://superwalllocal.authkit.app/?redirect_uri=http://localhost:64892/auth/callback';

type Reading = { ready: string; url: string } | 'error';

interface FakeChrome {
  readonly browserSocket: string;
  readonly methods: string[];
  readonly server: Server<undefined>;
}

const servers: Server<undefined>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true);
});

function startChrome(readings: ReadonlyArray<Reading>, options: { refuseTarget?: boolean } = {}): FakeChrome {
  const methods: string[] = [];
  let read = 0;
  const server = Bun.serve<undefined>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bunServer) {
      if (bunServer.upgrade(request)) return undefined;
      return new Response('', { status: 400 });
    },
    websocket: {
      message: (socket, message) => {
        const { id, method } = JSON.parse(String(message)) as { id: number; method: string };
        methods.push(method);
        if (method === 'Target.createTarget') {
          socket.send(
            JSON.stringify(
              options.refuseTarget
                ? { id, error: { message: 'No.' } }
                : { id, result: { targetId: 'page-1' } }
            )
          );
          return;
        }
        if (method === 'Runtime.evaluate') {
          const reading = readings[Math.min(read, readings.length - 1)];
          read += 1;
          socket.send(
            JSON.stringify(
              reading === 'error'
                ? { id, error: { message: 'Execution context was destroyed.' } }
                : { id, result: { result: { value: reading } } }
            )
          );
          return;
        }
        socket.send(JSON.stringify({ id, result: {} }));
      },
    },
  });
  servers.push(server);
  return { browserSocket: `ws://127.0.0.1:${server.port}/devtools/browser/fake`, methods, server };
}

function runCheck(
  chrome: FakeChrome | null,
  options: { unavailable?: BrowserUnavailable['reason']; cap?: Duration.Input; defaults?: boolean } = {}
) {
  const leases = { acquired: 0, released: 0 };
  const host = Layer.succeed(BrowserHost, {
    acquire: () =>
      options.unavailable
        ? Effect.fail(new BrowserUnavailable({ reason: options.unavailable, message: 'No browser.' }))
        : Effect.acquireRelease(
            Effect.sync(() => {
              leases.acquired += 1;
              return { webSocketUrl: chrome?.browserSocket ?? '' };
            }),
            () => Effect.sync(() => (leases.released += 1))
          ),
    openWindow: () => Effect.void,
    closeWindow: () => Effect.void,
    stop: () => Effect.void,
    remove: () => Effect.void,
    resolveMode: () => Effect.succeed('stopped' as const),
    resolveProfilePath: (profile) => profile,
  });
  const settings = Layer.succeed(BrowserSignInCheckSettings, {
    poll: '5 millis',
    settle: '30 millis',
    cap: options.cap ?? '2 seconds',
  });
  const layer = BrowserSignInCheck.layer.pipe(
    Layer.provide(options.defaults ? host : Layer.merge(host, settings))
  );
  return Effect.runPromise(
    Effect.flatMap(BrowserSignInCheck, (service) => service.check(SUPERWALL, REQUESTED)).pipe(
      Effect.provide(layer)
    )
  ).then((check) => ({ check, leases }));
}

describe('checking a sign-in in the shared browser', () => {
  test('a page that loads and stays on the requested address counts as signed in', async () => {
    const chrome = startChrome([
      { ready: 'loading', url: REQUESTED },
      { ready: 'complete', url: REQUESTED },
    ]);
    const { check, leases } = await runCheck(chrome);
    expect(check).toEqual({ kind: 'landed', url: REQUESTED });
    expect(chrome.methods[0]).toBe('Target.createTarget');
    expect(chrome.methods.at(-1)).toBe('Target.closeTarget');
    expect(leases).toEqual({ acquired: 1, released: 1 });
  });

  test('a page that loads, then moves on to a sign-in host, lands there', async () => {
    const chrome = startChrome([
      { ready: 'complete', url: REQUESTED },
      { ready: 'complete', url: REQUESTED },
      'error',
      { ready: 'loading', url: AUTHKIT },
      { ready: 'complete', url: AUTHKIT },
    ]);
    const { check } = await runCheck(chrome);
    expect(check).toEqual({ kind: 'landed', url: AUTHKIT });
    expect(chrome.methods.at(-1)).toBe('Target.closeTarget');
  });

  test('a page that never settles is reported as not checked, and its page is closed', async () => {
    const chrome = startChrome([{ ready: 'loading', url: REQUESTED }]);
    const { check, leases } = await runCheck(chrome, { cap: '100 millis' });
    expect(check).toEqual({ kind: 'unchecked', reason: 'timeout' });
    expect(chrome.methods.at(-1)).toBe('Target.closeTarget');
    expect(leases.released).toBe(1);
  });

  test.each(['not_installed', 'launch_failed', 'signing_in'] as const)(
    'a browser that is %s is reported as not checked for that reason',
    async (reason) => {
      const { check } = await runCheck(null, { unavailable: reason, defaults: true });
      expect(check).toEqual({ kind: 'unchecked', reason });
    }
  );

  test('a browser that refuses to open the page is reported as not answering', async () => {
    const chrome = startChrome([], { refuseTarget: true });
    const { check, leases } = await runCheck(chrome);
    expect(check).toEqual({ kind: 'unchecked', reason: 'failed' });
    expect(chrome.methods).toEqual(['Target.createTarget']);
    expect(leases).toEqual({ acquired: 1, released: 1 });
  });
});
