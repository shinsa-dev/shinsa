import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Effect, Exit, Layer, Redacted, Scope } from 'effect';
import { RemoteOrigin } from '../../apps/engine/src/remote/client/schema.ts';
import { RelayConnectorLayer } from '../../apps/engine/src/remote/layers.ts';
import { RelayConnector } from '../../apps/engine/src/remote/relay/service.ts';
import { resolveRelayUrl } from '../../packages/core/src/index.ts';
import { startLocalRelay } from './relay.ts';

setDefaultTimeout(15_000);

const INSTANCE = 'bench';

const stops: (() => unknown)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

function startEngine() {
  const server = Bun.serve<undefined>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bun) {
      const url = new URL(request.url);
      if (url.pathname === '/echo' && bun.upgrade(request, { data: undefined })) return undefined;
      if (url.pathname === '/refused') return new Response('Forbidden.', { status: 403 });
      return Response.json({ path: url.pathname, address: request.headers.get('cf-connecting-ip') });
    },
    websocket: { message: (socket, message) => void socket.send(message) },
  });
  stops.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

async function connectMachine(origin: string, localUrl: string) {
  const scope = Effect.runSync(Scope.make());
  stops.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  await Effect.runPromise(
    Effect.gen(function* () {
      const connector = yield* RelayConnector;
      yield* connector.open({ instanceId: INSTANCE, machineToken: Redacted.make('token'), localUrl });
    }).pipe(
      Scope.provide(scope),
      Effect.provide(RelayConnectorLayer.pipe(Layer.provide(Layer.succeed(RemoteOrigin, origin))))
    )
  );
}

function openBrowser(url: string) {
  const socket = new WebSocket(url);
  stops.push(() => socket.close());
  return new Promise<{ socket: WebSocket; status: 'open' | 'refused' }>((resolve) => {
    socket.addEventListener('open', () => resolve({ socket, status: 'open' }), { once: true });
    socket.addEventListener('error', () => resolve({ socket, status: 'refused' }), { once: true });
  });
}

describe('the local relay', () => {
  test('carries a request and a socket between a browser and the engine’s own connector', async () => {
    const relay = startLocalRelay();
    stops.push(relay.stop);
    const localUrl = startEngine();
    expect(relay.isConnected(INSTANCE)).toBe(false);
    expect((await relay.request(INSTANCE, '/health')).status).toBe(503);
    await connectMachine(relay.origin, localUrl);
    expect(relay.isConnected(INSTANCE)).toBe(true);
    const answer = await relay.request(INSTANCE, '/health');
    expect(await answer.json()).toEqual({ path: '/health', address: '0.0.0.0' });
    const browser = await openBrowser(`${resolveRelayUrl(INSTANCE, relay.origin)}/echo`);
    expect(browser.status).toBe('open');
    const echoed = new Promise((resolve) =>
      browser.socket.addEventListener('message', (event) => resolve(event.data), { once: true })
    );
    browser.socket.send('hello');
    expect(await echoed).toBe('hello');
    expect((await openBrowser(`${resolveRelayUrl(INSTANCE, relay.origin)}/refused`)).status).toBe('refused');
  });

  test('lets a machine that connects again replace its earlier socket', async () => {
    const relay = startLocalRelay();
    stops.push(relay.stop);
    const localUrl = startEngine();
    await connectMachine(relay.origin, localUrl);
    await connectMachine(relay.origin, localUrl);
    const answer = await relay.request(INSTANCE, '/again');
    expect(await answer.json()).toEqual({ path: '/again', address: '0.0.0.0' });
  });

  test('answers only its own paths', async () => {
    const relay = startLocalRelay();
    stops.push(relay.stop);
    expect((await fetch(`${relay.origin}/elsewhere`)).status).toBe(404);
  });
});
