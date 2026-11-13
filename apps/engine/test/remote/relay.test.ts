import { afterEach, describe, expect, test } from 'bun:test';
import { BunSocket } from '@effect/platform-bun';
import {
  encodeText,
  parseRelayControl,
  parseRelayData,
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_MAX_STREAMS,
  RELAY_PING,
  RELAY_PONG,
  type RelayControl,
  type RelayData,
  type RelayStreamId,
  serializeRelayControl,
  serializeRelayData,
} from '@shinsa/core';
import { Effect, Layer, Option, Redacted } from 'effect';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { resolveCloseCode, selectRefusalStatus } from '../../src/remote/relay/headers.ts';
import { createRefusedConnector } from '../../src/remote/relay/refused.ts';
import { RelayFetch, type RelayLink, RelayLimits } from '../../src/remote/relay/schema.ts';
import { RelayConnector } from '../../src/remote/relay/service.ts';
import { until } from '../helpers/index.ts';

const TOKEN = 'machine-token';
const UNREACHABLE_PORT = 1;

const LIMITS = {
  connectTimeout: '2 seconds',
  pingTimeout: '50 millis',
  dialTimeout: '2 seconds',
  requestBodyBytes: 16,
  messageBytes: 64,
} as const;

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface FakeRelay {
  readonly port: number;
  readonly auth: string[];
  readonly frames: (string | Uint8Array)[];
  answerPings: boolean;
  refuse: number | null;
  send(message: string | Uint8Array): void;
  drop(): void;
}

interface LocalSocket {
  send(message: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

const stops: (() => unknown)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function startRelay(): FakeRelay {
  let machine: LocalSocket | null = null;
  const relay: FakeRelay = {
    port: 0,
    auth: [],
    frames: [],
    answerPings: true,
    refuse: null,
    send: (message) => machine?.send(message),
    drop: () => machine?.close(1001, 'Going away.'),
  };
  const server = Bun.serve<undefined>({
    port: 0,
    fetch(request, bunServer) {
      relay.auth.push(request.headers.get('authorization') ?? '');
      if (relay.refuse !== null) return new Response('No.', { status: relay.refuse });
      if (new URL(request.url).pathname !== '/__relay/k3x9/machine') return new Response('', { status: 404 });
      if (bunServer.upgrade(request, { data: undefined })) return undefined;
      return new Response('', { status: 400 });
    },
    websocket: {
      open: (socket) => {
        machine = socket;
      },
      message: (socket, message) => {
        if (message === RELAY_PING && relay.answerPings) return void socket.send(RELAY_PONG);
        relay.frames.push(typeof message === 'string' ? message : new Uint8Array(message));
      },
    },
  });
  stops.push(() => server.stop(true));
  return Object.assign(relay, { port: server.port as number });
}

function startEngine() {
  const seen: Seen[] = [];
  const sockets: { protocol: string | null; closes: { code: number; reason: string }[] } = {
    protocol: null,
    closes: [],
  };
  const server = Bun.serve<undefined>({
    port: 0,
    async fetch(request, bunServer): Promise<Response | undefined> {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      });
      if (url.pathname === '/ws') {
        sockets.protocol = request.headers.get('sec-websocket-protocol');
        const headers = sockets.protocol ? { 'Sec-WebSocket-Protocol': sockets.protocol } : undefined;
        if (bunServer.upgrade(request, { data: undefined, headers })) return undefined;
      }
      if (url.pathname === '/ws-refused') return new Response('Forbidden.', { status: 403 });
      if (url.pathname === '/slow') return new Promise<Response>(() => undefined);
      if (url.pathname === '/moved')
        return new Response(null, { status: 302, headers: { location: '/there' } });
      if (url.pathname === '/zipped')
        return new Response(Bun.gzipSync(encodeText('hello')), {
          headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
        });
      return new Response(`echo ${request.method} ${url.pathname}`, { headers: { 'x-kind': 'echo' } });
    },
    websocket: {
      message: (socket, message) => {
        if (message === 'close-me') return void socket.close(4100, 'Bye.');
        if (message === 'big') return void socket.send('x'.repeat(100));
        socket.send(message);
      },
      close: (_socket, code, reason) => {
        sockets.closes.push({ code, reason });
      },
    },
  });
  stops.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}`, seen, sockets };
}

function readControls(relay: FakeRelay) {
  return relay.frames.flatMap((frame) =>
    typeof frame === 'string' ? Option.toArray(parseRelayControl(frame)) : []
  );
}

function readData(relay: FakeRelay) {
  return relay.frames.flatMap((frame) =>
    typeof frame === 'string' ? [] : Option.toArray(parseRelayData(new Uint8Array(frame)))
  );
}

function selectControl(relay: FakeRelay, stream: number, type: RelayControl['type']) {
  return readControls(relay).find(
    (frame): frame is Extract<RelayControl, { stream: RelayStreamId }> =>
      frame.type === type && 'stream' in frame && frame.stream === stream
  );
}

function readBody(relay: FakeRelay, stream: number) {
  return readData(relay)
    .filter((frame: RelayData) => frame.stream === stream)
    .map((frame) => new TextDecoder().decode(frame.payload))
    .join('');
}

function sendOpen(
  relay: FakeRelay,
  frame: Omit<Extract<RelayControl, { type: 'open' }>, 'type' | 'stream'> & { stream: number }
) {
  relay.send(serializeRelayControl({ type: 'open', ...frame, stream: frame.stream as RelayStreamId }));
}

function sendControl(relay: FakeRelay, frame: RelayControl) {
  relay.send(serializeRelayControl(frame));
}

function sendData(relay: FakeRelay, stream: number, payload: string, kind: 'text' | 'binary' = 'binary') {
  relay.send(serializeRelayData({ stream: stream as RelayStreamId, kind, payload: encodeText(payload) }));
}

function withLink(
  relay: FakeRelay,
  localUrl: string,
  body: (link: RelayLink) => Promise<void>,
  send: typeof fetch = fetch
) {
  const layer = RelayConnector.layer.pipe(
    Layer.provide(BunSocket.layerWebSocketConstructor),
    Layer.provide(Layer.succeed(RemoteOrigin, `http://127.0.0.1:${relay.port}`)),
    Layer.provide(Layer.succeed(RelayLimits, LIMITS)),
    Layer.provide(Layer.succeed(RelayFetch, send))
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const connector = yield* RelayConnector;
      const link = yield* connector.open({
        instanceId: 'k3x9',
        machineToken: Redacted.make(TOKEN),
        localUrl,
      });
      yield* Effect.promise(() => body(link));
    }).pipe(Effect.scoped, Effect.provide(layer))
  );
}

function openFails(relay: FakeRelay, localUrl: string) {
  const layer = RelayConnector.layer.pipe(
    Layer.provide(BunSocket.layerWebSocketConstructor),
    Layer.provide(Layer.succeed(RemoteOrigin, `http://127.0.0.1:${relay.port}`)),
    Layer.provide(Layer.succeed(RelayLimits, LIMITS))
  );
  return Effect.runPromise(
    RelayConnector.use((connector) =>
      connector.open({ instanceId: 'k3x9', machineToken: Redacted.make(TOKEN), localUrl })
    ).pipe(Effect.scoped, Effect.flip, Effect.provide(layer))
  );
}

describe('the relay connector', () => {
  test('signs in to the relay with the machine token, and answers pings until the relay stops answering', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async (link) => {
      expect(relay.auth).toEqual([`Bearer ${TOKEN}`]);
      expect(await Effect.runPromise(link.ping)).toBe(true);
      relay.answerPings = false;
      expect(await Effect.runPromise(link.ping)).toBe(false);
    });
  });

  test('fails with the status the relay refused it with, or none when the relay cannot be reached', async () => {
    const relay = startRelay();
    relay.refuse = 401;
    const refused = await openFails(relay, `http://127.0.0.1:${UNREACHABLE_PORT}`);
    expect(refused).toMatchObject({ _tag: 'RelayConnectFailed', status: 401 });
    const down = await openFails(
      { ...relay, port: UNREACHABLE_PORT },
      `http://127.0.0.1:${UNREACHABLE_PORT}`
    );
    expect(down).toMatchObject({ _tag: 'RelayConnectFailed', status: null });
  });

  test('answers that the relay closed the connection', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async (link) => {
      relay.drop();
      expect(await Effect.runPromise(link.closed)).toBe('Going away.');
    });
  });

  test('sends an HTTP stream to the engine marked as the tunnel, and its answer back in frames', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendOpen(relay, {
        stream: 1,
        kind: 'http',
        method: 'POST',
        path: '/api/hooks/s/t?x=1',
        headers: [
          ['host', 'app.shinsa.dev'],
          ['content-type', 'text/plain'],
          ['cf-connecting-ip', 'forged'],
        ],
        address: '203.0.113.9',
      });
      sendData(relay, 1, 'hel');
      sendData(relay, 1, 'lo');
      sendControl(relay, { type: 'end', stream: 1 as RelayStreamId });
      await until('the answer', () => selectControl(relay, 1, 'end') !== undefined);
      expect(engine.seen[0]).toMatchObject({ method: 'POST', path: '/api/hooks/s/t?x=1', body: 'hello' });
      expect(engine.seen[0]?.headers['cf-connecting-ip']).toBe('203.0.113.9');
      expect(engine.seen[0]?.headers.host).toBe(new URL(engine.url).host);
      expect(selectControl(relay, 1, 'response')).toMatchObject({ status: 200 });
      const response = selectControl(relay, 1, 'response') as Extract<RelayControl, { type: 'response' }>;
      expect(response.headers).toContainEqual(['x-kind', 'echo']);
      expect(response.headers.some(([name]) => name === 'content-length')).toBe(false);
      expect(readBody(relay, 1)).toBe('echo POST /api/hooks/s/t');
    });
  });

  test('holds an answer’s body while the relay pauses the stream, and sends it once the relay resumes', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendControl(relay, { type: 'pause', stream: 99 as RelayStreamId });
      sendOpen(relay, { stream: 4, kind: 'http', method: 'GET', path: '/held', headers: [] });
      sendControl(relay, { type: 'pause', stream: 4 as RelayStreamId });
      sendControl(relay, { type: 'end', stream: 4 as RelayStreamId });
      await until('the answer starts', () => selectControl(relay, 4, 'response') !== undefined);
      expect(readBody(relay, 4)).toBe('');
      expect(selectControl(relay, 4, 'end')).toBeUndefined();
      sendControl(relay, { type: 'resume', stream: 4 as RelayStreamId });
      await until('the answer ends', () => selectControl(relay, 4, 'end') !== undefined);
      expect(readBody(relay, 4)).toBe('echo GET /held');
    });
  });

  test('passes redirects and compressed bodies through untouched, and marks a request with no address', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendOpen(relay, { stream: 2, kind: 'http', method: 'GET', path: '/moved', headers: [] });
      sendControl(relay, { type: 'end', stream: 2 as RelayStreamId });
      sendOpen(relay, { stream: 3, kind: 'http', method: 'GET', path: '/zipped', headers: [] });
      sendData(relay, 3, 'ignored');
      sendControl(relay, { type: 'end', stream: 3 as RelayStreamId });
      await until(
        'both answers',
        () => selectControl(relay, 2, 'end') !== undefined && selectControl(relay, 3, 'end') !== undefined
      );
      expect(selectControl(relay, 2, 'response')).toMatchObject({ status: 302 });
      expect(engine.seen.find((seen) => seen.path === '/moved')?.headers['cf-connecting-ip']).toBe('0.0.0.0');
      expect(engine.seen.find((seen) => seen.path === '/zipped')?.body).toBe('');
      const zipped = readData(relay).filter((frame) => frame.stream === 3);
      expect(new TextDecoder().decode(Bun.gunzipSync(zipped[0]?.payload ?? new Uint8Array()))).toBe('hello');
    });
  });

  test('closes a stream whose body is too large, whose engine is unreachable, or that the relay cancels', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendOpen(relay, { stream: 4, kind: 'http', method: 'POST', path: '/big', headers: [] });
      sendData(relay, 4, 'x'.repeat(20));
      sendData(relay, 4, 'more');
      sendControl(relay, { type: 'end', stream: 4 as RelayStreamId });
      await until('the refusal', () => selectControl(relay, 4, 'close') !== undefined);
      expect(selectControl(relay, 4, 'close')).toMatchObject({ code: 4009 });
      sendOpen(relay, { stream: 5, kind: 'http', method: 'GET', path: '/slow', headers: [] });
      sendControl(relay, { type: 'end', stream: 5 as RelayStreamId });
      await until('the slow request', () => engine.seen.some((seen) => seen.path === '/slow'));
      sendControl(relay, { type: 'close', stream: 5 as RelayStreamId, code: 1000, reason: 'Cancelled.' });
      sendOpen(relay, { stream: 6, kind: 'http', method: 'GET', path: '/never-ended', headers: [] });
      sendControl(relay, { type: 'close', stream: 6 as RelayStreamId, code: 1000, reason: 'Cancelled.' });
      sendControl(relay, { type: 'end', stream: 6 as RelayStreamId });
      sendOpen(relay, { stream: 7, kind: 'http', method: 'GET', path: '/after', headers: [] });
      sendControl(relay, { type: 'end', stream: 7 as RelayStreamId });
      await until('the next request', () => selectControl(relay, 7, 'end') !== undefined);
      expect(selectControl(relay, 5, 'response')).toBeUndefined();
      expect(engine.seen.some((seen) => seen.path === '/never-ended')).toBe(false);
    });
    const breaking = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull: (controller) => {
              controller.enqueue(encodeText('part'));
              controller.error(new Error('Broke.'));
            },
          })
        )
      )) as unknown as typeof fetch;
    await withLink(
      relay,
      engine.url,
      async () => {
        sendOpen(relay, { stream: 15, kind: 'http', method: 'GET', path: '/broken', headers: [] });
        sendControl(relay, { type: 'end', stream: 15 as RelayStreamId });
        await until('the broken answer', () => selectControl(relay, 15, 'close') !== undefined);
        expect(selectControl(relay, 15, 'response')).toMatchObject({ status: 200 });
        expect(selectControl(relay, 15, 'end')).toBeUndefined();
      },
      breaking
    );
    await withLink(relay, `http://127.0.0.1:${UNREACHABLE_PORT}`, async () => {
      sendOpen(relay, { stream: 8, kind: 'http', method: 'GET', path: '/', headers: [] });
      sendControl(relay, { type: 'end', stream: 8 as RelayStreamId });
      await until('the failure', () => selectControl(relay, 8, 'close') !== undefined);
      expect(selectControl(relay, 8, 'close')).toMatchObject({
        code: 1011,
        reason: 'The engine did not answer.',
      });
    });
  });

  test('ignores frames it cannot read or for streams it does not know, and opens a stream only once', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      relay.send('not json');
      relay.send(new Uint8Array([9, 0, 0, 0, 1]));
      sendData(relay, 40, 'nobody');
      sendControl(relay, { type: 'end', stream: 40 as RelayStreamId });
      sendControl(relay, { type: 'close', stream: 40 as RelayStreamId, code: 1000, reason: '' });
      sendOpen(relay, { stream: 9, kind: 'http', method: 'GET', path: '/once', headers: [] });
      sendOpen(relay, { stream: 9, kind: 'http', method: 'GET', path: '/twice', headers: [] });
      sendControl(relay, { type: 'end', stream: 9 as RelayStreamId });
      sendControl(relay, { type: 'end', stream: 9 as RelayStreamId });
      await until('the answer', () => selectControl(relay, 9, 'end') !== undefined);
      sendData(relay, 9, 'late');
      expect(engine.seen.map((seen) => seen.path)).toEqual(['/once']);
    });
  });

  test('refuses a stream past the limit of open streams', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      for (let stream = 1; stream <= RELAY_MAX_STREAMS + 1; stream += 1)
        sendOpen(relay, { stream, kind: 'http', method: 'GET', path: '/', headers: [] });
      await until('the refusal', () => selectControl(relay, RELAY_MAX_STREAMS + 1, 'close') !== undefined);
      expect(selectControl(relay, RELAY_MAX_STREAMS + 1, 'close')).toMatchObject({
        code: 4003,
        reason: 'This machine has too many open streams.',
      });
    });
  });

  test('opens a socket stream on the engine with its protocol, and carries text and binary both ways', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendOpen(relay, {
        stream: 10,
        kind: 'socket',
        method: 'GET',
        path: '/ws',
        headers: [
          ['origin', 'https://app.shinsa.dev'],
          ['sec-websocket-protocol', 'shinsa, other'],
        ],
        address: '203.0.113.9',
      });
      await until('the upgrade', () => selectControl(relay, 10, 'response') !== undefined);
      expect(selectControl(relay, 10, 'response')).toEqual({
        type: 'response',
        stream: 10 as RelayStreamId,
        status: 101,
        headers: [['sec-websocket-protocol', 'shinsa']],
      });
      const seen = engine.seen.find((entry) => entry.path === '/ws');
      expect(seen?.headers.origin).toBe('https://app.shinsa.dev');
      expect(seen?.headers['cf-connecting-ip']).toBe('203.0.113.9');
      sendData(relay, 10, 'hello ', 'text');
      sendData(relay, 10, 'world', 'binary');
      await until('the echoes', () => readData(relay).filter((frame) => frame.stream === 10).length === 2);
      expect(readData(relay).map((frame) => frame.kind)).toEqual(['text', 'binary']);
      expect(readBody(relay, 10)).toBe('hello world');
      sendControl(relay, { type: 'close', stream: 10 as RelayStreamId, code: 4200, reason: 'Browser left.' });
      await until('the engine to see the close', () => engine.sockets.closes.length === 1);
      expect(engine.sockets.closes[0]).toEqual({ code: 4200, reason: 'Browser left.' });
      expect(selectControl(relay, 10, 'close')).toBeUndefined();
    });
  });

  test('hands on the engine closing a socket, refusing one, and a message too large for the relay', async () => {
    const relay = startRelay();
    const engine = startEngine();
    await withLink(relay, engine.url, async () => {
      sendOpen(relay, { stream: 11, kind: 'socket', method: 'GET', path: '/ws', headers: [] });
      await until('the upgrade', () => selectControl(relay, 11, 'response') !== undefined);
      expect(selectControl(relay, 11, 'response')).toMatchObject({ status: 101, headers: [] });
      sendData(relay, 11, 'close-me', 'text');
      await until('the close', () => selectControl(relay, 11, 'close') !== undefined);
      expect(selectControl(relay, 11, 'close')).toMatchObject({ code: 4100, reason: 'Bye.' });
      sendOpen(relay, { stream: 12, kind: 'socket', method: 'GET', path: '/ws-refused', headers: [] });
      await until('the refusal', () => selectControl(relay, 12, 'response') !== undefined);
      expect(selectControl(relay, 12, 'response')).toMatchObject({ status: 403 });
      sendOpen(relay, { stream: 13, kind: 'socket', method: 'GET', path: '/ws', headers: [] });
      await until('the upgrade', () => selectControl(relay, 13, 'response') !== undefined);
      sendData(relay, 13, 'big', 'text');
      await until('the close', () => selectControl(relay, 13, 'close') !== undefined);
      expect(selectControl(relay, 13, 'close')).toMatchObject({ code: 4009 });
      await until('the engine to see it', () => engine.sockets.closes.some((close) => close.code === 4009));
    });
  });

  test('answers 502 for a socket the engine cannot be reached for', async () => {
    const relay = startRelay();
    await withLink(relay, `http://127.0.0.1:${UNREACHABLE_PORT}`, async () => {
      sendOpen(relay, { stream: 14, kind: 'socket', method: 'GET', path: '/ws', headers: [] });
      await until('the refusal', () => selectControl(relay, 14, 'response') !== undefined);
      expect(selectControl(relay, 14, 'response')).toMatchObject({ status: 502 });
    });
  });
});

describe('the relay connector’s helpers', () => {
  test('a close code the relay cannot send becomes a normal close', () => {
    expect([
      resolveCloseCode(4100),
      resolveCloseCode(1006),
      resolveCloseCode(999),
      resolveCloseCode(5000),
    ]).toEqual([4100, 1000, 1000, 1000]);
  });

  test('a refused connect is read for its status only when it names one', async () => {
    const refusal = await openFails(
      { ...startRelay(), refuse: null, port: UNREACHABLE_PORT },
      `http://127.0.0.1:${UNREACHABLE_PORT}`
    );
    expect(refusal).toMatchObject({ status: null });
    expect(Option.isNone(selectRefusalStatus({ reason: { _tag: 'SocketReadError' } } as never))).toBe(true);
  });

  test('the limits default to the relay’s own, and requests go through fetch', async () => {
    const defaults = await Effect.runPromise(
      Effect.gen(function* () {
        return [yield* RelayLimits, yield* RelayFetch];
      })
    );
    expect(defaults).toEqual([
      {
        connectTimeout: '30 seconds',
        pingTimeout: '10 seconds',
        dialTimeout: '10 seconds',
        requestBodyBytes: 32 * 1024 * 1024,
        messageBytes: RELAY_MAX_MESSAGE_BYTES,
      },
      fetch,
    ]);
  });

  test('the refused connector fails every open', async () => {
    const failure = await Effect.runPromise(
      RelayConnector.use((connector) =>
        connector.open({
          instanceId: 'k3x9',
          machineToken: Redacted.make(TOKEN),
          localUrl: `http://127.0.0.1:${UNREACHABLE_PORT}`,
        })
      ).pipe(Effect.scoped, Effect.flip, Effect.provide(createRefusedConnector('No relay here.')))
    );
    expect(failure).toMatchObject({ _tag: 'RelayConnectFailed', message: 'No relay here.', status: null });
  });
});
