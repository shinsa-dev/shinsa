import { describe, expect, test } from 'bun:test';
import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  CHANNEL_COMPRESSION,
  type ChannelCompression,
  type ChannelMessage,
  encodeText,
  type GuestActor,
  MAX_TERMINAL_STREAMS,
  parseBodyChunk,
  REMOTE_KEY_ALGORITHM,
  serializeBase64Url,
  serializePublicKey,
  TERMINAL_STREAM_CLOSE,
} from '@shinsa/core';
import type { HubSocket } from '../../src/http/socket.ts';
import {
  type AccessAnswer,
  type ChannelHost,
  RemoteChannel,
  TERMINAL_STREAM_MESSAGES,
} from '../../src/remote/channel.ts';
import type { TerminalSession, TerminalViewer } from '../../src/terminals/session.ts';
import { createKeyPair, serializeDeviceKey, startHandshake, type TestSession } from './client.ts';

interface FakeTerminal {
  attached: TerminalViewer[];
  typed: (string | Uint8Array)[];
  sizes: [number, number][];
  cleared: number;
  drained: number;
}

function createFakeTerminal(): FakeTerminal & TerminalSession {
  const fake: FakeTerminal = { attached: [], typed: [], sizes: [], cleared: 0, drained: 0 };
  return Object.assign(fake, {
    attach: (viewer: TerminalViewer) => {
      fake.attached.push(viewer);
      viewer.send('{"type":"reset","cols":80,"rows":24}');
      viewer.send(encodeText('$ '));
    },
    detach: (viewer: TerminalViewer) => {
      fake.attached = fake.attached.filter((each) => each !== viewer);
    },
    drain: () => {
      fake.drained += 1;
    },
    input: (data: string | Uint8Array) => fake.typed.push(data),
    resize: (cols: number, rows: number) => fake.sizes.push([cols, rows]),
    replaceColors: () => undefined,
    clear: () => {
      fake.cleared += 1;
    },
  }) as unknown as FakeTerminal & TerminalSession;
}

interface Harness {
  terminals: Map<string, FakeTerminal & TerminalSession>;
  guest: GuestActor | null;
  channel: RemoteChannel;
  sent: (string | Bytes)[];
  dropping: boolean;
  closed: { code: number; reason: string }[];
  hubOpened: HubSocket[];
  hubClosed: HubSocket[];
  hubMessages: string[];
  requests: Request[];
  machineKey: string;
  enrolled: Set<string>;
  seen: string[];
  owner: boolean;
  access: { answer: AccessAnswer; asked: (string | null)[]; waiting: AccessAnswer | null };
}

async function createHarness(
  respond?: (request: Request) => Promise<Response>,
  maxBodyBytes = 1024,
  firstState = '{"type":"state"}'
) {
  const machine = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const machineKey = await serializePublicKey(machine.publicKey);
  const harness = {
    sent: [],
    dropping: false,
    closed: [],
    hubOpened: [],
    hubClosed: [],
    hubMessages: [],
    requests: [],
    machineKey,
    enrolled: new Set<string>(),
    seen: [],
    owner: false,
    terminals: new Map(),
    guest: null,
    access: { answer: { kind: 'refused', reason: 'This link was turned off.' }, asked: [], waiting: null },
  } as unknown as Harness;
  const host: ChannelHost = {
    resolveMachineKey: () => Promise.resolve({ publicKey: machineKey, privateKey: machine.privateKey }),
    isEnrolled: (device) => harness.enrolled.has(device),
    resolveGuest: () => harness.guest,
    isOwner: () => harness.owner,
    requestAccess: (_proof, _keys, name) => {
      harness.access.asked.push(name);
      return Promise.resolve(harness.access.answer);
    },
    resumeAccess: () => harness.access.waiting,
    recordSeen: (device) => harness.seen.push(device),
    hub: {
      open: (socket) => {
        harness.hubOpened.push(socket);
        socket.send(firstState);
      },
      close: (socket) => harness.hubClosed.push(socket),
      message: (_socket, raw) => harness.hubMessages.push(raw),
    },
    respond: (request) => {
      harness.requests.push(request);
      return respond ? respond(request) : Promise.resolve(new Response('ok'));
    },
    terminals: { select: (id) => harness.terminals.get(id) ?? null },
    maxBodyBytes,
  };
  harness.channel = new RemoteChannel(
    {
      send: (data) => (harness.dropping ? 0 : harness.sent.push(data)),
      close: (code, reason) => harness.closed.push({ code, reason }),
      buffered: () => 0,
    },
    host
  );
  return harness;
}

async function connect(harness: Harness, compression: ChannelCompression[] = []) {
  const device = await createKeyPair();
  harness.enrolled.add(await serializeDeviceKey(device));
  const start = await startHandshake({ machineKey: harness.machineKey, device, compression });
  await harness.channel.receive(start.hello);
  const session = await start.finish(harness.sent[0] as string);
  await until(() => harness.sent.length >= 2);
  const ready = await session.open(harness.sent[1] as Bytes);
  expect(ready).toEqual({ t: 'ready' });
  return { session, device, read: 2 };
}

async function until(condition: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(1);
  }
}

async function readFrom(harness: Harness, session: TestSession, from: number) {
  const messages: ChannelMessage[] = [];
  for (const frame of harness.sent.slice(from)) {
    const message = await session.open(frame as Bytes);
    if (message) messages.push(message);
  }
  return messages;
}

describe('the sealed channel', () => {
  test('opens for an enrolled device and runs the app socket inside it', async () => {
    const harness = await createHarness();
    const { session } = await connect(harness);
    expect(harness.seen).toHaveLength(1);
    expect(harness.channel.isOpen).toBe(true);
    expect(harness.channel.device).toBe(harness.seen[0] ?? '');
    await harness.channel.receive(await session.seal({ t: 'ready' }));
    await harness.channel.receive(await session.seal({ t: 'ready' }));
    expect(harness.hubOpened).toHaveLength(1);
    expect(harness.hubOpened[0]?.data.origin).toBe('remote');
    harness.owner = true;
    expect(harness.hubOpened[0]?.data.origin).toBe('owner');
    await until(() => harness.sent.length >= 3);
    expect(await readFrom(harness, session, 2)).toEqual([{ t: 'socket', data: '{"type":"state"}' }]);
    await harness.channel.receive(await session.seal({ t: 'socket', data: '{"type":"state.sync"}' }));
    expect(harness.hubMessages).toEqual(['{"type":"state.sync"}']);
    harness.channel.close();
    expect(harness.hubClosed).toHaveLength(1);
    await harness.channel.receive('ignored once closed');
  });

  test('deflates large frames both ways once the hello offered compression', async () => {
    const state = JSON.stringify({ type: 'state', tasks: Array.from({ length: 4000 }, (_, id) => ({ id })) });
    const harness = await createHarness(undefined, 1024, state);
    const { session } = await connect(harness, [CHANNEL_COMPRESSION]);
    expect(JSON.parse(harness.sent[0] as string)).toMatchObject({ compression: CHANNEL_COMPRESSION });
    expect(session.compression).toBe(CHANNEL_COMPRESSION);
    await harness.channel.receive(await session.seal({ t: 'ready' }));
    await until(() => harness.sent.length >= 3);
    expect((harness.sent[2] as Bytes).length).toBeLessThan(state.length / 4);
    expect(await readFrom(harness, session, 2)).toEqual([{ t: 'socket', data: state }]);
    await harness.channel.receive(await session.seal({ t: 'socket', data: state }));
    expect(harness.hubMessages).toEqual([state]);
  });

  test('keeps plain frames for a hello that offers no compression', async () => {
    const harness = await createHarness();
    const { session } = await connect(harness);
    expect(JSON.parse(harness.sent[0] as string)).toMatchObject({ compression: null });
    expect(session.compression).toBeNull();
  });

  test('closes the channel and its app socket when a sealed frame is dropped', async () => {
    const harness = await createHarness();
    const { session } = await connect(harness);
    harness.dropping = true;
    await harness.channel.receive(await session.seal({ t: 'ready' }));
    await until(() => harness.closed.length > 0);
    expect(harness.closed[0]).toEqual({ code: 1008, reason: 'The channel dropped a frame.' });
    expect(harness.channel.isOpen).toBe(false);
    expect(harness.hubClosed).toHaveLength(1);
  });

  test('refuses a device that is not enrolled and has no enrollment proof', async () => {
    const harness = await createHarness();
    const start = await startHandshake({ machineKey: harness.machineKey, device: await createKeyPair() });
    await harness.channel.receive(start.hello);
    expect(JSON.parse(harness.sent[0] as string)).toMatchObject({ type: 'refused' });
    expect(harness.closed[0]?.code).toBe(1008);
    expect(harness.channel.isOpen).toBe(false);
  });

  async function startRequest(harness: Harness) {
    return startHandshake({
      machineKey: harness.machineKey,
      device: await createKeyPair(),
      enrollSecret: serializeBase64Url(new Uint8Array(32).fill(1)),
      name: 'Bob iPhone',
    });
  }

  function createDecision() {
    let decide: (approved: boolean) => void = () => undefined;
    const decided = new Promise<boolean>((resolve) => {
      decide = resolve;
    });
    return { answer: { kind: 'waiting', decided } satisfies AccessAnswer, decide };
  }

  test('a new device with a link proof asks for access, waits, and is let in once accepted', async () => {
    const harness = await createHarness();
    const decision = createDecision();
    harness.access.answer = decision.answer;
    const start = await startRequest(harness);
    void harness.channel.receive(start.hello);
    await until(() => harness.sent.length > 0);
    expect(JSON.parse(harness.sent[0] as string)).toEqual({ type: 'pending' });
    expect(harness.access.asked).toEqual(['Bob iPhone']);
    decision.decide(true);
    await until(() => harness.sent.length >= 3);
    const session = await start.finish(harness.sent[1] as string);
    expect(await session.open(harness.sent[2] as Bytes)).toEqual({ t: 'ready' });
  });

  test('a device that asked before comes back without its link and waits on the same request', async () => {
    const harness = await createHarness();
    const decision = createDecision();
    harness.access.waiting = decision.answer;
    const start = await startHandshake({ machineKey: harness.machineKey, device: await createKeyPair() });
    void harness.channel.receive(start.hello);
    await until(() => harness.sent.length > 0);
    expect(JSON.parse(harness.sent[0] as string)).toEqual({ type: 'pending' });
    expect(harness.access.asked).toEqual([]);
    decision.decide(true);
    await until(() => harness.sent.length >= 3);
    const session = await start.finish(harness.sent[1] as string);
    expect(await session.open(harness.sent[2] as Bytes)).toEqual({ t: 'ready' });
  });

  test('a declined request is refused, and a refused one says why', async () => {
    const declined = await createHarness();
    const decision = createDecision();
    declined.access.answer = decision.answer;
    void declined.channel.receive((await startRequest(declined)).hello);
    await until(() => declined.sent.length > 0);
    decision.decide(false);
    await until(() => declined.closed.length > 0);
    expect(JSON.parse(declined.sent[1] as string)).toEqual({
      type: 'refused',
      reason: 'Your request to reach this machine was declined.',
    });
    const refused = await createHarness();
    await refused.channel.receive((await startRequest(refused)).hello);
    expect(JSON.parse(refused.sent[0] as string)).toEqual({
      type: 'refused',
      reason: 'This link was turned off.',
    });
  });

  test('says nothing more to a browser that left while it waited', async () => {
    const harness = await createHarness();
    const decision = createDecision();
    harness.access.answer = decision.answer;
    void harness.channel.receive((await startRequest(harness)).hello);
    await until(() => harness.sent.length > 0);
    harness.channel.close();
    decision.decide(true);
    await Bun.sleep(5);
    expect(harness.sent).toHaveLength(1);
  });

  test('closes on anything but a hello first, a frame during the handshake, or plain text after it', async () => {
    const first = await createHarness();
    await first.channel.receive(new Uint8Array([1, 2, 3]));
    expect(first.closed[0]?.reason).toContain('hello first');
    const second = await createHarness();
    await second.channel.receive('{"type":"hello"}');
    expect(second.closed[0]?.reason).toContain('hello first');
    const third = await createHarness();
    const { session: _session } = await connect(third);
    await third.channel.receive('plain');
    expect(third.closed[0]?.reason).toContain('only carries sealed frames');
  });

  test('closes when a frame does not open or holds no channel message', async () => {
    const harness = await createHarness();
    await connect(harness);
    await harness.channel.receive(new Uint8Array(40).buffer);
    expect(harness.closed[0]?.reason).toBe('The channel broke.');
    const other = await createHarness();
    const { session } = await connect(other);
    await other.channel.receive(await session.seal({ t: 'socket', data: 'before ready' }));
    expect(other.hubMessages).toHaveLength(0);
    await other.channel.receive(await session.sealText('{"t":"unknown"}'));
    expect(other.closed[0]?.reason).toContain('no channel message');
    const third = await createHarness();
    const { session: thirdSession } = await connect(third);
    await third.channel.receive(
      await thirdSession.seal({ t: 'response', id: 'r', status: 200, headers: [] })
    );
    expect(third.closed[0]?.reason).toContain('cannot send a response');
  });

  test('runs an HTTP request through the host and streams the answer back in chunks', async () => {
    const big = new Uint8Array(CHANNEL_BODY_CHUNK_BYTES + 10).fill(7);
    const harness = await createHarness(
      async (incoming) => new Response(big, { status: 201, headers: { 'x-echo': await incoming.text() } }),
      CHANNEL_BODY_CHUNK_BYTES * 4
    );
    const { session } = await connect(harness);
    await harness.channel.receive(
      await session.seal({
        t: 'request',
        id: 'r1',
        method: 'POST',
        path: '/api/commands',
        headers: [
          ['content-type', 'application/json'],
          ['host', 'evil'],
          ['cookie', 'c'],
          ['sec-fetch-site', 'cross-site'],
        ],
      })
    );
    await harness.channel.receive(
      await session.seal({ t: 'body', id: 'r1', chunk: serializeBase64Url(encodeText('{"a":1}')) })
    );
    await harness.channel.receive(await session.seal({ t: 'end', id: 'r1' }));
    await until(() => harness.sent.length >= 6);
    const request = harness.requests[0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/commands');
    expect(request.headers.get('cookie')).toBeNull();
    expect(request.headers.get('sec-fetch-site')).toBeNull();
    expect(request.headers.get('content-type')).toBe('application/json');
    const messages = await readFrom(harness, session, 2);
    expect(messages[0]).toMatchObject({ t: 'response', id: 'r1', status: 201 });
    expect((messages[0] as { headers: [string, string][] }).headers).toContainEqual(['x-echo', '{"a":1}']);
    const body = messages.filter((message) => message.t === 'body') as { chunk: string }[];
    expect(body.reduce((total, part) => total + (parseBodyChunk(part.chunk)?.length ?? 0), 0)).toBe(
      big.length
    );
    expect(messages.at(-1)).toEqual({ t: 'end', id: 'r1' });
  });

  test('answers a GET without a body, a failing route with 500 and an empty body with only an end', async () => {
    const harness = await createHarness((request) =>
      request.url.endsWith('/boom')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(new Response(null, { status: 204 }))
    );
    const { session } = await connect(harness);
    for (const [id, path] of [
      ['a', '/api/x'],
      ['b', '/api/boom'],
    ] as const) {
      await harness.channel.receive(
        await session.seal({ t: 'request', id, method: 'GET', path, headers: [] })
      );
      await harness.channel.receive(await session.seal({ t: 'end', id }));
    }
    await until(() => harness.sent.length >= 6);
    const messages = await readFrom(harness, session, 2);
    expect(messages).toContainEqual({ t: 'response', id: 'a', status: 204, headers: [] });
    expect(messages).toContainEqual({ t: 'response', id: 'b', status: 500, headers: [] });
    expect(messages.filter((message) => message.t === 'end')).toHaveLength(2);
  });

  test('refuses a body over the limit, a duplicate id and an unsafe path', async () => {
    const harness = await createHarness(undefined, 4);
    const { session } = await connect(harness);
    await harness.channel.receive(
      await session.seal({ t: 'request', id: 'big', method: 'POST', path: '/api/x', headers: [] })
    );
    await harness.channel.receive(
      await session.seal({ t: 'body', id: 'big', chunk: serializeBase64Url(new Uint8Array(5)) })
    );
    await harness.channel.receive(await session.seal({ t: 'body', id: 'big', chunk: '!' }));
    await harness.channel.receive(await session.seal({ t: 'end', id: 'big' }));
    await until(() => harness.sent.length >= 4);
    expect(await readFrom(harness, session, 2)).toEqual([
      { t: 'response', id: 'big', status: 413, headers: [] },
      { t: 'end', id: 'big' },
    ]);
    expect(harness.requests).toHaveLength(0);
    await harness.channel.receive(
      await session.seal({ t: 'request', id: 'x', method: 'GET', path: '//evil/api', headers: [] })
    );
    expect(harness.closed[0]?.reason).toContain('not valid');
  });

  test('answers 429 once too many requests are open, and aborts open ones when closed', async () => {
    const harness = await createHarness(() => new Promise(() => undefined));
    const { session } = await connect(harness);
    for (let index = 0; index < 33; index++) {
      await harness.channel.receive(
        await session.seal({ t: 'request', id: `r${index}`, method: 'GET', path: '/api/x', headers: [] })
      );
    }
    await until(() => harness.sent.length >= 4);
    expect(await readFrom(harness, session, 2)).toEqual([
      { t: 'response', id: 'r32', status: 429, headers: [] },
      { t: 'end', id: 'r32' },
    ]);
    await harness.channel.receive(await session.seal({ t: 'end', id: 'r0' }));
    await harness.channel.receive(await session.seal({ t: 'abort', id: 'r1' }));
    await until(() => harness.requests.length === 1);
    const request = harness.requests[0] as Request;
    harness.channel.close();
    expect(request.signal.aborted).toBe(true);
  });

  test('stops streaming a response the browser aborted', async () => {
    let push: (chunk: Bytes) => void = () => undefined;
    const harness = await createHarness(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              push = (chunk) => controller.enqueue(chunk);
            },
          })
        )
      )
    );
    const { session } = await connect(harness);
    await harness.channel.receive(
      await session.seal({ t: 'request', id: 's', method: 'GET', path: '/api/stream', headers: [] })
    );
    await harness.channel.receive(await session.seal({ t: 'end', id: 's' }));
    await until(() => harness.sent.length >= 3);
    push(encodeText('line\n'));
    await until(() => harness.sent.length >= 4);
    await harness.channel.receive(await session.seal({ t: 'abort', id: 's' }));
    const messages = await readFrom(harness, session, 2);
    expect(messages.map((message) => message.t)).toEqual(['response', 'body']);
  });

  test('fails a handshake that lost a race with close', async () => {
    const harness = await createHarness();
    const device = await createKeyPair();
    harness.enrolled.add(await serializeDeviceKey(device));
    const start = await startHandshake({ machineKey: harness.machineKey, device });
    const receiving = harness.channel.receive(start.hello);
    harness.channel.close();
    await receiving;
    expect(harness.sent).toHaveLength(0);
    harness.channel.fail('again');
    expect(harness.closed).toHaveLength(0);
  });
});

describe('terminal streams in the sealed channel', () => {
  async function connectAs(owner: boolean, guest: GuestActor | null = null) {
    const harness = await createHarness();
    harness.owner = owner;
    harness.guest = guest;
    const terminal = createFakeTerminal();
    harness.terminals.set('term-1', terminal);
    const { session } = await connect(harness);
    let read = 2;
    const send = (message: ChannelMessage) =>
      session.seal(message).then((frame) => harness.channel.receive(frame));
    const next = async (count: number) => {
      await until(() => harness.sent.length >= read + count);
      const messages = await readFrom(harness, session, read);
      read = harness.sent.length;
      return messages;
    };
    return { harness, terminal, send, next };
  }

  test('streams a terminal to the owner and takes its keys, resizes and clears', async () => {
    const { harness, terminal, send, next } = await connectAs(true);
    await send({ t: 'terminal-open', id: 's1', terminal: 'term-1' });
    expect(await next(2)).toEqual([
      { t: 'terminal-text', id: 's1', data: '{"type":"reset","cols":80,"rows":24}' },
      { t: 'terminal-bytes', id: 's1', chunk: serializeBase64Url(encodeText('$ ')) },
    ]);
    await until(() => terminal.drained > 0);
    await send({ t: 'terminal-bytes', id: 's1', chunk: serializeBase64Url(encodeText('ls\r')) });
    await send({ t: 'terminal-text', id: 's1', data: '{"type":"resize","cols":100,"rows":30}' });
    await send({ t: 'terminal-text', id: 's1', data: '{"type":"clear"}' });
    await send({ t: 'terminal-bytes', id: 's1', chunk: '!' });
    await send({ t: 'terminal-bytes', id: 'other', chunk: 'AA' });
    expect(terminal.typed).toEqual([encodeText('ls\r')]);
    expect(terminal.sizes).toEqual([[100, 30]]);
    expect(terminal.cleared).toBe(1);
    harness.channel.drain();
    expect(terminal.attached[0]?.buffered()).toBe(0);
    await send({ t: 'terminal-close', id: 's1', code: TERMINAL_STREAM_CLOSE.normal, reason: '' });
    expect(terminal.attached).toHaveLength(0);
    await send({ t: 'terminal-close', id: 's1', code: TERMINAL_STREAM_CLOSE.normal, reason: '' });
    expect(harness.closed).toHaveLength(0);
  });

  test('tells the browser when its terminal ends, and detaches every stream when the channel closes', async () => {
    const { harness, terminal, send, next } = await connectAs(true);
    await send({ t: 'terminal-open', id: 's1', terminal: 'term-1' });
    await next(2);
    const [viewer] = terminal.attached;
    terminal.attached = [];
    viewer?.end();
    viewer?.end();
    expect(await next(1)).toEqual([
      {
        t: 'terminal-close',
        id: 's1',
        code: TERMINAL_STREAM_CLOSE.gone,
        reason: TERMINAL_STREAM_MESSAGES.closed,
      },
    ]);
    await send({ t: 'terminal-open', id: 's2', terminal: 'term-1' });
    expect(terminal.attached).toHaveLength(1);
    harness.channel.close();
    expect(terminal.attached).toHaveLength(0);
  });

  test('refuses a member and a guest', async () => {
    const member = await connectAs(false);
    await member.send({ t: 'terminal-open', id: 's', terminal: 'term-1' });
    expect(await member.next(1)).toEqual([
      {
        t: 'terminal-close',
        id: 's',
        code: TERMINAL_STREAM_CLOSE.refused,
        reason: TERMINAL_STREAM_MESSAGES.ownerOnly,
      },
    ]);
    expect(member.terminal.attached).toHaveLength(0);
    const guest = await connectAs(true, { taskId: 'task-1', login: 'kai' });
    await guest.send({ t: 'terminal-open', id: 's', terminal: 'term-1' });
    expect((await guest.next(1))[0]).toMatchObject({ code: TERMINAL_STREAM_CLOSE.refused });
    expect(guest.terminal.attached).toHaveLength(0);
  });

  test('says a terminal is gone, and caps how many one page opens', async () => {
    const { terminal, send, next } = await connectAs(true);
    await send({ t: 'terminal-open', id: 'gone', terminal: 'term-9' });
    expect((await next(1))[0]).toMatchObject({ t: 'terminal-close', code: TERMINAL_STREAM_CLOSE.gone });
    for (let index = 0; index < MAX_TERMINAL_STREAMS; index += 1)
      await send({ t: 'terminal-open', id: `s${index}`, terminal: 'term-1' });
    await next(MAX_TERMINAL_STREAMS * 2);
    await send({ t: 'terminal-open', id: 'one-more', terminal: 'term-1' });
    expect(await next(1)).toEqual([
      {
        t: 'terminal-close',
        id: 'one-more',
        code: TERMINAL_STREAM_CLOSE.refused,
        reason: TERMINAL_STREAM_MESSAGES.tooMany,
      },
    ]);
    expect(terminal.attached).toHaveLength(MAX_TERMINAL_STREAMS);
  });

  test('closes the channel on a stream id that is taken or too long', async () => {
    const taken = await connectAs(true);
    await taken.send({ t: 'terminal-open', id: 's1', terminal: 'term-1' });
    await taken.send({ t: 'terminal-open', id: 's1', terminal: 'term-1' });
    expect(taken.harness.closed).toEqual([{ code: 1008, reason: 'A terminal stream was not valid.' }]);
    const long = await connectAs(true);
    await long.send({ t: 'terminal-open', id: 'x'.repeat(65), terminal: 'term-1' });
    expect(long.harness.closed).toHaveLength(1);
  });
});
