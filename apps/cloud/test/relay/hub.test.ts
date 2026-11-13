import { describe, expect, test } from 'bun:test';
import {
  type Bytes,
  encodeText,
  parseRelayControl,
  parseRelayData,
  RELAY_CHUNK_BYTES,
  RELAY_CLOSE,
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_MAX_STREAMS,
  RELAY_PING,
  RELAY_PONG,
  type RelayControl,
  type RelayData,
  RelayStreamId,
  serializeRelayControl,
  serializeRelayData,
} from '@shinsa/core';
import { Effect, Fiber, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { createRelayHub } from '../../src/relay/hub.ts';
import {
  RELAY_ADDRESS_HEADER,
  RELAY_ROLE_HEADER,
  RELAY_ROOM_ORIGIN,
  type RelayHub,
  type RelayPeer,
  type RelayRole,
  type RelayRoom,
  type RelayTag,
} from '../../src/relay/schema.ts';

interface FakePeer extends RelayPeer {
  readonly sent: (string | Bytes)[];
  closed: { code: number; reason: string } | null;
}

function createPeer(tag: RelayTag): FakePeer {
  const peer: FakePeer = {
    tag,
    sent: [],
    closed: null,
    isOpen: () => !peer.closed,
    send: (message) => {
      if (peer.closed) throw new Error('The socket is closed.');
      peer.sent.push(message);
    },
    close: (code, reason) => {
      if (peer.closed) throw new Error('The socket is closed.');
      peer.closed = { code, reason };
    },
  };
  return peer;
}

function createRoom() {
  const peers: FakePeer[] = [];
  const room: RelayRoom = {
    listPeers: () => peers,
    accept: (tag, protocol) => {
      peers.push(createPeer(tag));
      return new Response(null, {
        status: 200,
        headers: { 'x-accepted': tag.role, ...(protocol ? { 'x-protocol': protocol } : {}) },
      });
    },
  };
  return { room, peers };
}

function roomRequest(role: RelayRole | 'other', path = '/', init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(RELAY_ROLE_HEADER, role);
  return new Request(`${RELAY_ROOM_ORIGIN}${path}`, { ...init, headers });
}

async function createHub() {
  const { room, peers } = createRoom();
  const hub = createRelayHub(room);
  return { hub, peers, run: <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect) };
}

async function connectMachine(hub: RelayHub, peers: FakePeer[]) {
  const answer = await Effect.runPromise(hub.fetch(roomRequest('machine')));
  expect(answer.headers.get('x-accepted')).toBe('machine');
  return peers.at(-1) as FakePeer;
}

function listControls(peer: FakePeer) {
  return peer.sent.flatMap((message) =>
    typeof message === 'string' ? Option.toArray(parseRelayControl(message)) : []
  );
}

function listData(peer: FakePeer) {
  return peer.sent.flatMap((message) =>
    typeof message === 'string' ? [] : Option.toArray(parseRelayData(message))
  );
}

async function waitFor<A>(read: () => A | undefined) {
  for (let turn = 0; turn < 200; turn++) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(1);
  }
  throw new Error('Nothing arrived.');
}

function waitForOpen(machine: FakePeer, index = 0) {
  return waitFor(() => listControls(machine).filter((frame) => frame.type === 'open')[index]) as Promise<
    Extract<RelayControl, { type: 'open' }>
  >;
}

function control(frame: RelayControl) {
  return serializeRelayControl(frame);
}

function data(frame: RelayData) {
  const bytes = serializeRelayData(frame);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('the relay hub', () => {
  test('refuses a request whose role it does not know', async () => {
    const { hub, run } = await createHub();
    const answer = await run(hub.fetch(roomRequest('other')));
    expect(answer.status).toBe(400);
  });

  test('answers 503 for a request and a socket while no machine is connected', async () => {
    const { hub, run } = await createHub();
    const request = await run(hub.fetch(roomRequest('http', '/api/hooks/a/b')));
    expect(request.status).toBe(503);
    expect(await request.text()).toBe('This machine is not connected.');
    expect((await run(hub.fetch(roomRequest('socket', '/remote')))).status).toBe(503);
  });

  test('carries a request to the machine and streams its answer back', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const body = new Uint8Array(RELAY_CHUNK_BYTES + 10).fill(7);
    const pending = run(
      hub.fetch(
        roomRequest('http', '/api/hooks/s/t?source=maple', {
          method: 'POST',
          headers: { 'content-type': 'application/json', [RELAY_ADDRESS_HEADER]: '203.0.113.9' },
          body,
        })
      )
    );
    const open = await waitForOpen(machine);
    expect(open).toEqual({
      type: 'open',
      stream: open.stream,
      kind: 'http',
      method: 'POST',
      path: '/api/hooks/s/t?source=maple',
      headers: [['content-type', 'application/json']],
      address: '203.0.113.9',
    });
    await waitFor(() => listControls(machine).find((frame) => frame.type === 'end'));
    const sent = listData(machine);
    expect(
      sent.every((frame) => frame.payload.length <= RELAY_CHUNK_BYTES && frame.stream === open.stream)
    ).toBe(true);
    expect(sent.reduce((total, frame) => total + frame.payload.length, 0)).toBe(body.length);
    await run(
      hub.receive(
        machine,
        control({ type: 'response', stream: open.stream, status: 202, headers: [['x-a', '1']] })
      )
    );
    await run(hub.receive(machine, data({ stream: open.stream, kind: 'binary', payload: encodeText('he') })));
    await run(
      hub.receive(machine, data({ stream: open.stream, kind: 'binary', payload: encodeText('llo') }))
    );
    await run(hub.receive(machine, control({ type: 'end', stream: open.stream })));
    const answer = await pending;
    expect(answer.status).toBe(202);
    expect(answer.headers.get('x-a')).toBe('1');
    expect(await answer.text()).toBe('hello');
    expect(listControls(machine).filter((frame) => frame.type === 'close')).toEqual([]);
  });

  test('gives a bodiless answer no body, and sends a request without a body as an open and an end', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(hub.fetch(roomRequest('http', '/health')));
    const open = await waitForOpen(machine);
    expect(listControls(machine).map((frame) => frame.type)).toEqual(['open', 'end']);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 204, headers: [] }))
    );
    const answer = await pending;
    expect(answer.status).toBe(204);
    expect(answer.body).toBeNull();
  });

  test('ends the request on the machine when its body fails to read', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const broken = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new Error('gone')),
    });
    const pending = run(
      hub.fetch(
        roomRequest('http', '/api/hooks/a/b', { method: 'POST', body: broken, duplex: 'half' } as RequestInit)
      )
    );
    const open = await waitForOpen(machine);
    await waitFor(() => listControls(machine).find((frame) => frame.type === 'end'));
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 400, headers: [] }))
    );
    await run(hub.receive(machine, control({ type: 'end', stream: open.stream })));
    expect((await pending).status).toBe(400);
  });

  test('pauses the machine while an answer waits unread, and resumes it once the reader catches up', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(hub.fetch(roomRequest('http', '/__preview/p/download')));
    const open = await waitForOpen(machine);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 200, headers: [] }))
    );
    const answer = await pending;
    const flow = () =>
      listControls(machine)
        .filter((frame) => frame.type === 'pause' || frame.type === 'resume')
        .map((frame) => frame.type);
    const chunk = new Uint8Array(RELAY_CHUNK_BYTES).fill(1);
    for (let index = 0; index < 16; index++)
      await run(hub.receive(machine, data({ stream: open.stream, kind: 'binary', payload: chunk })));
    expect(flow()).toEqual([]);
    for (let index = 0; index < 4; index++)
      await run(hub.receive(machine, data({ stream: open.stream, kind: 'binary', payload: chunk })));
    expect(flow()).toEqual(['pause']);
    expect(listControls(machine).find((frame) => frame.type === 'pause')).toEqual({
      type: 'pause',
      stream: open.stream,
    });
    await run(hub.receive(machine, control({ type: 'end', stream: open.stream })));
    const reader = answer.body?.getReader();
    let read = 0;
    while (reader) {
      const next = await reader.read();
      if (next.done) break;
      read += next.value.length;
    }
    expect(read).toBe(20 * RELAY_CHUNK_BYTES);
    expect(flow()).toEqual(['pause', 'resume']);
  });

  test('tells the machine to stop when the reader cancels the body', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(hub.fetch(roomRequest('http', '/__preview/p/stream')));
    const open = await waitForOpen(machine);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 200, headers: [] }))
    );
    const answer = await pending;
    await answer.body?.cancel();
    const close = await waitFor(() => listControls(machine).find((frame) => frame.type === 'close'));
    expect(close).toEqual({
      type: 'close',
      stream: open.stream,
      code: RELAY_CLOSE.normal,
      reason: 'The request was cancelled.',
    });
  });

  test('fails the body when the machine closes the stream halfway', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(hub.fetch(roomRequest('http', '/__preview/p/page')));
    const open = await waitForOpen(machine);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 200, headers: [] }))
    );
    await run(
      hub.receive(
        machine,
        control({ type: 'close', stream: open.stream, code: 1011, reason: 'The engine stopped.' })
      )
    );
    const answer = await pending;
    expect(answer.text()).rejects.toBeDefined();
  });

  test('answers 502 when the machine closes the stream before it answers', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(hub.fetch(roomRequest('http', '/api/slack/events', { method: 'POST', body: '{}' })));
    const open = await waitForOpen(machine);
    await run(hub.receive(machine, control({ type: 'close', stream: open.stream, code: 1000, reason: '' })));
    expect((await pending).status).toBe(502);
  });

  test('answers 504 and closes the stream when the machine does not answer in time', async () => {
    const { hub, peers } = await createHub();
    const machine = await connectMachine(hub, peers);
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(hub.fetch(roomRequest('http', '/api/hooks/a/b')));
        yield* Effect.promise(() => waitForOpen(machine));
        yield* TestClock.adjust('101 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(answer.status).toBe(504);
    expect(listControls(machine).at(-1)).toMatchObject({
      type: 'close',
      reason: 'The request was cancelled.',
    });
  });

  test('answers 504 for a socket the machine never answers', async () => {
    const { hub, peers } = await createHub();
    const machine = await connectMachine(hub, peers);
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(hub.fetch(roomRequest('socket', '/remote')));
        yield* Effect.promise(() => waitForOpen(machine));
        yield* TestClock.adjust('101 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(answer.status).toBe(504);
  });

  test('accepts a browser socket the machine accepts, with the protocol it chose', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const pending = run(
      hub.fetch(
        roomRequest('socket', '/remote?token=abc', {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-key': 'key',
            'sec-websocket-version': '13',
            'sec-websocket-protocol': 'shinsa',
            origin: 'https://app.shinsa.dev',
          },
        })
      )
    );
    const open = await waitForOpen(machine);
    expect(open.kind).toBe('socket');
    expect(open.path).toBe('/remote?token=abc');
    expect(open.headers).toEqual([
      ['origin', 'https://app.shinsa.dev'],
      ['sec-websocket-protocol', 'shinsa'],
    ]);
    expect(open).not.toHaveProperty('address');
    await run(
      hub.receive(
        machine,
        control({
          type: 'response',
          stream: open.stream,
          status: 101,
          headers: [['Sec-WebSocket-Protocol', 'shinsa']],
        })
      )
    );
    const answer = await pending;
    expect(answer.headers.get('x-accepted')).toBe('browser');
    expect(answer.headers.get('x-protocol')).toBe('shinsa');
    expect(peers.at(-1)?.tag).toEqual({ role: 'browser', stream: open.stream });
  });

  test('passes on the machine refusing a socket, and accepts one without a protocol', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const refused = run(hub.fetch(roomRequest('socket', '/remote')));
    const first = await waitForOpen(machine);
    await run(
      hub.receive(
        machine,
        control({ type: 'response', stream: first.stream, status: 403, headers: [['x-why', 'device']] })
      )
    );
    const answer = await refused;
    expect(answer.status).toBe(403);
    expect(answer.headers.get('x-why')).toBe('device');
    const accepted = run(hub.fetch(roomRequest('socket', '/team')));
    const second = await waitForOpen(machine, 1);
    expect(second.stream).not.toBe(first.stream);
    await run(
      hub.receive(machine, control({ type: 'response', stream: second.stream, status: 101, headers: [] }))
    );
    expect((await accepted).headers.has('x-protocol')).toBe(false);
  });

  test('carries messages both ways between a browser and the machine', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const stream = RelayStreamId.make((browser.tag as { stream: number }).stream);
    await run(hub.receive(browser, 'hello'));
    await run(hub.receive(browser, new Uint8Array([1, 2, 3]).buffer));
    expect(listData(machine).map((frame) => [frame.stream, frame.kind, [...frame.payload]])).toEqual([
      [stream, 'text', [...encodeText('hello')]],
      [stream, 'binary', [1, 2, 3]],
    ]);
    await run(hub.receive(machine, data({ stream, kind: 'text', payload: encodeText('back') })));
    await run(hub.receive(machine, data({ stream, kind: 'binary', payload: new Uint8Array([9]) })));
    expect(browser.sent[0]).toBe('back');
    expect([...(browser.sent[1] as Bytes)]).toEqual([9]);
  });

  test('closes a browser that sends a message over the limit, and tells the machine', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    await run(hub.receive(browser, new ArrayBuffer(RELAY_MAX_MESSAGE_BYTES)));
    expect(browser.closed).toEqual({ code: RELAY_CLOSE.tooLarge, reason: 'The message is too large.' });
    expect(listControls(machine).at(-1)).toMatchObject({ type: 'close', code: RELAY_CLOSE.tooLarge });
  });

  test('closes a browser the machine closes, with a code a browser may use', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const stream = RelayStreamId.make((browser.tag as { stream: number }).stream);
    await run(hub.receive(machine, control({ type: 'close', stream, code: 1006, reason: 'x'.repeat(120) })));
    expect(browser.closed).toEqual({ code: 1000, reason: 'x'.repeat(120) });
    const other = await openBrowser(hub, peers, machine, 1);
    const second = RelayStreamId.make((other.tag as { stream: number }).stream);
    await run(
      hub.receive(machine, control({ type: 'close', stream: second, code: 4403, reason: 'Refused.' }))
    );
    expect(other.closed).toEqual({ code: 4403, reason: 'Refused.' });
  });

  test('tells the machine when a browser closes, and closes a browser that writes once the machine is gone', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const stream = RelayStreamId.make((browser.tag as { stream: number }).stream);
    await run(hub.closed(browser, 1005, ''));
    expect(listControls(machine).at(-1)).toEqual({ type: 'close', stream, code: 1000, reason: '' });
    const other = await openBrowser(hub, peers, machine, 1);
    machine.closed = { code: 1006, reason: '' };
    await run(hub.receive(other, 'late'));
    expect(other.closed).toEqual({ code: RELAY_CLOSE.machineGone, reason: 'The machine disconnected.' });
    await run(hub.closed(other, 1000, ''));
  });

  test('drops every stream when the machine goes, and keeps them when a newer machine socket is up', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const pending = run(hub.fetch(roomRequest('http', '/api/hooks/a/b')));
    await waitForOpen(machine, 1);
    machine.closed = { code: 1006, reason: '' };
    await run(hub.closed(machine, 1006, ''));
    expect(browser.closed).toEqual({ code: RELAY_CLOSE.machineGone, reason: 'The machine disconnected.' });
    expect((await pending).status).toBe(502);
    const next = await connectMachine(hub, peers);
    const kept = await openBrowser(hub, peers, next);
    await run(hub.closed(machine, 1006, ''));
    expect(kept.closed).toBeNull();
  });

  test('replaces a machine that connects again, closing the old socket and its streams', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const pending = run(hub.fetch(roomRequest('http', '/__preview/p/body')));
    const open = await waitForOpen(machine, 1);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 200, headers: [] }))
    );
    const body = await pending;
    await connectMachine(hub, peers);
    expect(machine.closed).toEqual({ code: RELAY_CLOSE.replaced, reason: 'The machine connected again.' });
    expect(browser.closed?.code).toBe(RELAY_CLOSE.machineGone);
    expect(body.text()).rejects.toBeDefined();
  });

  test('sends nothing to a replaced machine socket its peer never closed, only to the new one', async () => {
    const { hub, peers, run } = await createHub();
    const replaced = await connectMachine(hub, peers);
    const machine = await connectMachine(hub, peers);
    expect(peers).toContain(replaced);
    const pending = run(hub.fetch(roomRequest('http', '/api/hooks/a/b')));
    const open = await waitForOpen(machine);
    await run(
      hub.receive(machine, control({ type: 'response', stream: open.stream, status: 204, headers: [] }))
    );
    expect((await pending).status).toBe(204);
    expect(replaced.sent).toEqual([]);
    await run(hub.closed(replaced, RELAY_CLOSE.replaced, 'gone'));
    const next = run(hub.fetch(roomRequest('http', '/api/hooks/a/c')));
    const reopened = await waitForOpen(machine, 1);
    await run(
      hub.receive(machine, control({ type: 'response', stream: reopened.stream, status: 204, headers: [] }))
    );
    expect((await next).status).toBe(204);
  });

  test('evicts a removed machine, closing its socket and every stream, and is a no-op with none', async () => {
    const { hub, peers, run } = await createHub();
    expect((await run(hub.fetch(roomRequest('evict')))).status).toBe(204);
    const machine = await connectMachine(hub, peers);
    const browser = await openBrowser(hub, peers, machine);
    const evicted = await run(hub.fetch(roomRequest('evict')));
    expect(evicted.status).toBe(204);
    expect(machine.closed).toEqual({ code: RELAY_CLOSE.refused, reason: 'This machine was removed.' });
    expect(browser.closed?.code).toBe(RELAY_CLOSE.machineGone);
    expect((await run(hub.fetch(roomRequest('http', '/api/hooks/a/b')))).status).toBe(503);
  });

  test('answers a ping and ignores what it cannot read or place', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    const stream = RelayStreamId.make(99);
    await run(hub.receive(machine, RELAY_PING));
    expect(machine.sent).toEqual([RELAY_PONG]);
    await run(hub.receive(machine, 'not json'));
    await run(hub.receive(machine, new Uint8Array([9, 9]).buffer));
    await run(hub.receive(machine, data({ stream, kind: 'text', payload: encodeText('lost') })));
    await run(hub.receive(machine, control({ type: 'response', stream, status: 200, headers: [] })));
    await run(hub.receive(machine, control({ type: 'end', stream })));
    await run(hub.receive(machine, control({ type: 'close', stream, code: 1000, reason: '' })));
    await run(hub.receive(machine, RELAY_PONG));
    expect(machine.sent).toEqual([RELAY_PONG]);
    expect(machine.closed).toBeNull();
  });

  test('refuses a new stream once a machine has the most it may hold, and skips ids in use', async () => {
    const { hub, peers, run } = await createHub();
    const machine = await connectMachine(hub, peers);
    peers.push(createPeer({ role: 'browser', stream: 1 }));
    const pending = run(hub.fetch(roomRequest('socket', '/remote')));
    expect((await waitForOpen(machine)).stream).toBe(RelayStreamId.make(2));
    for (let stream = 3; peers.length <= RELAY_MAX_STREAMS + 1; stream++)
      peers.push(createPeer({ role: 'browser', stream }));
    const busy = await run(hub.fetch(roomRequest('http', '/health')));
    expect(busy.status).toBe(503);
    expect(await busy.text()).toBe('This machine has too many open streams.');
    expect((await run(hub.fetch(roomRequest('socket', '/remote')))).status).toBe(503);
    machine.closed = { code: 1006, reason: '' };
    await run(hub.closed(machine, 1006, ''));
    expect((await pending).status).toBe(502);
  });
});

async function openBrowser(hub: RelayHub, peers: FakePeer[], machine: FakePeer, index = 0) {
  const pending = Effect.runPromise(hub.fetch(roomRequest('socket', '/remote')));
  const opens = () =>
    listControls(machine).filter((frame) => frame.type === 'open' && frame.kind === 'socket');
  const open = (await waitFor(() => opens()[index])) as Extract<RelayControl, { type: 'open' }>;
  await Effect.runPromise(
    hub.receive(
      machine,
      serializeRelayControl({ type: 'response', stream: open.stream, status: 101, headers: [] })
    )
  );
  await pending;
  return peers.at(-1) as FakePeer;
}
