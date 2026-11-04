import { afterEach, describe, expect, test } from 'bun:test';
import { BunSocket } from '@effect/platform-bun';
import {
  type Bytes,
  type ChannelMessage,
  createFrameSealer,
  deriveServerSession,
  encodeText,
  parseClientHello,
  serializeChannelMessage,
  serializePublicKey,
  verifyEnrollProof,
} from '@shinsa/core';
import { Effect, Exit, Layer } from 'effect';
import type { HubSocket } from '../../src/http/socket.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { AccessAnswer, RemoteChannelHandle } from '../../src/remote/channel/schema.ts';
import { makeRemoteChannel } from '../../src/remote/channel/service.ts';
import {
  DEVICE_CHANNEL_MESSAGES,
  DeviceChannelError,
  type DeviceChannelLink,
  type DeviceChannelOptions,
  DeviceRequestAborted,
} from '../../src/remote/device-channel/schema.ts';
import { DeviceChannels } from '../../src/remote/device-channel/service.ts';
import { createKeyPair } from './client.ts';

const ORIGIN = 'https://machine.shinsa.internal';

const SECRET = 'c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LXNlY3JldA';

const layer = Layer.merge(
  DeviceChannels.layer.pipe(Layer.provide(BunSocket.layerWebSocketConstructor)),
  JsonLogger
);

function run<A, E>(effect: Effect.Effect<A, E, DeviceChannels>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

function runExit<A, E>(effect: Effect.Effect<A, E, DeviceChannels>) {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));
}

function openLink(options: DeviceChannelOptions) {
  return run(Effect.flatMap(DeviceChannels, (channels) => channels.open(options)));
}

function openExit(options: DeviceChannelOptions) {
  return runExit(Effect.flatMap(DeviceChannels, (channels) => channels.open(options)));
}

function failureOf<A, E>(exit: Exit.Exit<A, E>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected a failure.');
  const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail');
  if (!failure || failure._tag !== 'Fail') throw new Error('Expected a typed failure.');
  return failure.error;
}

interface SocketData {
  channel: RemoteChannelHandle | null;
}

interface MachineOptions {
  access?: (
    proof: string,
    keys: { machine: string; device: string; clientEphemeral: string }
  ) => AccessAnswer;
  respond?: (request: Request) => Promise<Response>;
}

interface Machine {
  url: string;
  machineKey: string;
  origins: (string | null)[];
  hubMessages: string[];
  hubSockets: HubSocket[];
  requests: { method: string; path: string; body: string }[];
  aborted: string[];
  enrolled: Set<string>;
  closeAll: () => void;
  stop: () => void;
}

const servers: { stop: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

async function startMachine(options: MachineOptions = {}): Promise<Machine> {
  const keys = (await createKeyPair()) as CryptoKeyPair;
  const machineKey = await Effect.runPromise(serializePublicKey(keys.publicKey));
  const sockets = new Set<Bun.ServerWebSocket<SocketData>>();
  const machine: Machine = {
    url: '',
    machineKey,
    origins: [],
    hubMessages: [],
    hubSockets: [],
    requests: [],
    aborted: [],
    enrolled: new Set(),
    closeAll: () => {
      for (const socket of sockets) socket.close(4001, 'Remote access was turned off.');
    },
    stop: () => undefined,
  };
  const respond = (request: Request) =>
    Effect.promise(async () => {
      const body = await request.text();
      request.signal.addEventListener('abort', () => machine.aborted.push(new URL(request.url).pathname));
      machine.requests.push({ method: request.method, path: new URL(request.url).pathname, body });
      if (options.respond) return options.respond(request);
      return Response.json({ path: new URL(request.url).pathname, body });
    });
  const server = Bun.serve<SocketData>({
    port: 0,
    fetch: (request, bun) => {
      machine.origins.push(request.headers.get('origin'));
      return bun.upgrade(request, { data: { channel: null } })
        ? undefined
        : new Response('Upgrade required', { status: 426 });
    },
    websocket: {
      open: (socket) => {
        sockets.add(socket);
        socket.data.channel = Effect.runSync(
          makeRemoteChannel({
            send: (data) => Effect.sync(() => socket.send(data)),
            buffered: undefined,
            closePeer: (code, reason) => Effect.sync(() => socket.close(code, reason)),
            machineKey: Effect.succeed({ publicKey: machineKey, privateKey: keys.privateKey }),
            isEnrolled: (device) => Effect.sync(() => machine.enrolled.has(device)),
            resolveGuest: () => Effect.succeed(null),
            isOwner: Effect.succeed(false),
            requestAccess: (proof, proofKeys) =>
              Effect.gen(function* () {
                const answer = options.access?.(proof, proofKeys);
                if (answer) return answer;
                const valid = yield* verifyEnrollProof(SECRET, proof, proofKeys);
                if (!valid)
                  return { kind: 'refused', reason: 'That grant is not valid.' } satisfies AccessAnswer;
                machine.enrolled.add(proofKeys.device);
                return { kind: 'admitted' } satisfies AccessAnswer;
              }),
            resumeAccess: () => Effect.succeed(null),
            recordSeen: () => Effect.void,
            openSocket: (hub) =>
              Effect.sync(() => {
                machine.hubSockets.push(hub);
                hub.send('{"type":"state"}');
              }),
            closeSocket: () => Effect.void,
            receiveSocket: (_hub, raw) => Effect.sync(() => machine.hubMessages.push(raw)),
            terminals: null,
            respond: (request) => respond(request),
            maxBodyBytes: 4 * 1024 * 1024,
          }).pipe(Effect.provide(JsonLogger))
        );
      },
      message: (socket, message) => {
        const channel = socket.data.channel;
        if (!channel) return;
        void Effect.runPromise(
          channel.receive(typeof message === 'string' ? message : new Uint8Array(message))
        );
      },
      close: (socket) => {
        sockets.delete(socket);
        const channel = socket.data.channel;
        if (channel) void Effect.runPromise(channel.close);
      },
    },
  });
  servers.push(server);
  machine.url = `ws://127.0.0.1:${server.port}/remote`;
  machine.stop = () => {
    void server.stop(true);
  };
  return machine;
}

type Script = (input: {
  sendRaw: (data: string | Bytes) => void;
  close: () => void;
  sendSealed: (message: ChannelMessage | string) => Promise<void>;
}) => Promise<void>;

async function startScripted(script: Script, handshake = true) {
  const keys = (await createKeyPair()) as CryptoKeyPair;
  const machineKey = await Effect.runPromise(serializePublicKey(keys.publicKey));
  const server = Bun.serve<undefined>({
    port: 0,
    fetch: (request, bun) => (bun.upgrade(request, { data: undefined }) ? undefined : new Response('no')),
    websocket: {
      message: (socket, raw) => {
        void answer(socket, raw);
      },
    },
  });
  async function answer(socket: Bun.ServerWebSocket<undefined>, raw: string | Buffer) {
    const sendRaw = (data: string | Bytes) => socket.send(data);
    const close = () => socket.close();
    if (!handshake) return script({ sendRaw, close, sendSealed: () => Promise.resolve() });
    const hello = typeof raw === 'string' ? parseClientHello(raw) : null;
    if (!hello) return;
    const ephemeral = (await createKeyPair()) as CryptoKeyPair;
    const serverEphemeral = await Effect.runPromise(serializePublicKey(ephemeral.publicKey));
    const session = await Effect.runPromise(
      deriveServerSession({
        keys: {
          machine: machineKey,
          device: hello.device,
          clientEphemeral: hello.ephemeral,
          serverEphemeral,
        },
        machinePrivateKey: keys.privateKey,
        serverEphemeralPrivateKey: ephemeral.privateKey,
      })
    );
    const seal = createFrameSealer(session.send, null);
    socket.send(JSON.stringify({ type: 'welcome', ephemeral: serverEphemeral, compression: null }));
    const sendSealed = async (message: ChannelMessage | string) => {
      const text = typeof message === 'string' ? message : serializeChannelMessage(message);
      socket.send(await Effect.runPromise(seal(encodeText(text))));
    };
    await sendSealed({ t: 'ready' });
    await script({ sendRaw, close, sendSealed });
  }
  servers.push(server);
  return { url: `ws://127.0.0.1:${server.port}/remote`, machineKey };
}

async function linkOptions(machine: { url: string; machineKey: string }, secret: string | null = SECRET) {
  return {
    url: machine.url,
    origin: ORIGIN,
    machineKey: machine.machineKey,
    device: (await createKeyPair()) as CryptoKeyPair,
    enrollSecret: secret,
    name: 'Studio',
  } satisfies DeviceChannelOptions;
}

function sendRequest(
  link: DeviceChannelLink,
  path: string,
  body: string | null = null,
  signal?: AbortSignal
) {
  return run(
    link.request({
      method: body === null ? 'GET' : 'POST',
      path,
      headers: [['content-type', 'application/json']],
      body: body === null ? null : encodeText(body),
      ...(signal ? { signal } : {}),
    })
  );
}

function nextSocket(link: DeviceChannelLink) {
  return new Promise<string>((resolve) => {
    let heard: string | null = null;
    const stop = link.subscribeSocket((data) => {
      heard ??= data;
    });
    stop();
    if (heard !== null) return resolve(heard);
    const later = link.subscribeSocket((data) => {
      later();
      resolve(data);
    });
  });
}

function nextClose(link: DeviceChannelLink) {
  return new Promise<DeviceChannelError>((resolve) => {
    link.subscribeClose(resolve);
  });
}

describe('the engine as a sealed channel client', () => {
  test('enrols with a grant, sends its origin, and relays requests, bodies and socket messages', async () => {
    const machine = await startMachine();
    const options = await linkOptions(machine);
    const link = await openLink(options);
    expect(await Effect.runPromise(link.isOpen)).toBe(true);
    expect(machine.enrolled.size).toBe(1);
    expect(machine.origins).toEqual([ORIGIN]);

    const read = await sendRequest(link, '/api/tasks/T-1');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ path: '/api/tasks/T-1', body: '' });

    const posted = await sendRequest(link, '/api/commands', '{"type":"task.retry"}');
    expect(await posted.json()).toEqual({ path: '/api/commands', body: '{"type":"task.retry"}' });
    expect(machine.requests.map((each) => each.method)).toEqual(['GET', 'POST']);

    const state = nextSocket(link);
    await run(link.sendSocket('{"type":"hello"}'));
    expect(await state).toBe('{"type":"state"}');
    await Bun.sleep(20);
    expect(machine.hubMessages).toEqual(['{"type":"hello"}']);

    await run(link.close);
    expect(await Effect.runPromise(link.isOpen)).toBe(false);
  });

  test('resumes as an enrolled device without a grant', async () => {
    const machine = await startMachine();
    const options = await linkOptions(machine);
    const first = await openLink(options);
    await run(first.close);
    const again = await openLink({ ...options, enrollSecret: null });
    expect((await sendRequest(again, '/api/health')).status).toBe(200);
    expect(machine.enrolled.size).toBe(1);
  });

  test('streams large and empty answers', async () => {
    const big = 'x'.repeat(600 * 1024);
    const machine = await startMachine({
      respond: (incoming) =>
        Promise.resolve(
          new URL(incoming.url).pathname === '/empty'
            ? new Response(null, { status: 204 })
            : new Response(big)
        ),
    });
    const link = await openLink(await linkOptions(machine));
    expect(await (await sendRequest(link, '/big')).text()).toBe(big);
    const empty = await sendRequest(link, '/empty');
    expect(empty.status).toBe(204);
    expect(empty.body).toBeNull();
  });

  test('aborts a request the caller gave up on', async () => {
    const machine = await startMachine({
      respond: (incoming) =>
        new Promise((resolve) =>
          incoming.signal.addEventListener('abort', () => resolve(new Response('late')))
        ),
    });
    const link = await openLink(await linkOptions(machine));
    const controller = new AbortController();
    const pending = runExit(
      link.request({ method: 'GET', path: '/slow', headers: [], body: null, signal: controller.signal })
    );
    await Bun.sleep(50);
    controller.abort();
    expect(failureOf(await pending)).toBeInstanceOf(DeviceRequestAborted);
    await Bun.sleep(50);
    expect(machine.aborted).toEqual(['/slow']);
  });

  test('says why the machine refused, closed or could not be reached', async () => {
    const machine = await startMachine();
    const refused = failureOf(
      await openExit(await linkOptions(machine, 'd3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldC13cm9uZw'))
    );
    expect(refused).toMatchObject({ message: 'That grant is not valid.', refused: true });

    const link = await openLink(await linkOptions(machine));
    const slow = runExit(link.request({ method: 'GET', path: '/x', headers: [], body: null }));
    const closed = nextClose(link);
    const unwatched: DeviceChannelError[] = [];
    link.subscribeClose((error) => unwatched.push(error))();
    machine.closeAll();
    expect(await closed).toMatchObject({ message: 'Remote access was turned off.', refused: false });
    expect(await Effect.runPromise(link.isOpen)).toBe(false);
    await slow;
    const after = failureOf(
      await runExit(link.request({ method: 'GET', path: '/x', headers: [], body: null }))
    );
    expect(after).toMatchObject({ message: DEVICE_CHANNEL_MESSAGES.closed });
    expect(unwatched).toEqual([]);
    const late: DeviceChannelError[] = [];
    link.subscribeClose((error) => late.push(error))();
    expect(late.map((error) => error.message)).toEqual(['Remote access was turned off.']);

    machine.stop();
    const unreachable = failureOf(await openExit(await linkOptions(machine)));
    expect(unreachable).toBeInstanceOf(DeviceChannelError);
    expect(unreachable).toMatchObject({ message: DEVICE_CHANNEL_MESSAGES.unreachable, refused: false });
  });

  test('waits while the machine holds a request, then opens once it is approved', async () => {
    const machine = await startMachine({
      access: (_proof, keys) => ({
        kind: 'waiting',
        decided: Effect.sync(() => {
          machine.enrolled.add(keys.device);
          return true;
        }).pipe(Effect.delay('20 millis')),
      }),
    });
    const link = await openLink(await linkOptions(machine));
    expect(await Effect.runPromise(link.isOpen)).toBe(true);
  });

  test('refuses a key it cannot read and a broken grant before dialling', async () => {
    const machine = await startMachine();
    const options = await linkOptions(machine);
    expect(failureOf(await openExit({ ...options, machineKey: 'not-a-key' }))).toMatchObject({
      message: DEVICE_CHANNEL_MESSAGES.keyInvalid,
    });
    expect(failureOf(await openExit({ ...options, enrollSecret: '!' }))).toMatchObject({
      message: DEVICE_CHANNEL_MESSAGES.broke,
    });
    expect(machine.origins).toEqual([]);
  });

  test('closes on a handshake or message it does not expect', async () => {
    const binaryHello = await startScripted(async ({ sendRaw }) => sendRaw(new Uint8Array([1, 2, 3])), false);
    expect(failureOf(await openExit(await linkOptions(binaryHello)))).toMatchObject({
      message: DEVICE_CHANNEL_MESSAGES.handshakeMissing,
    });

    const strangeHello = await startScripted(async ({ sendRaw }) => sendRaw('{"type":"hi"}'), false);
    expect(failureOf(await openExit(await linkOptions(strangeHello)))).toMatchObject({
      message: DEVICE_CHANNEL_MESSAGES.handshakeUnknown,
    });

    const badWelcome = await startScripted(
      async ({ sendRaw }) => sendRaw('{"type":"welcome","ephemeral":"nope","compression":null}'),
      false
    );
    expect(failureOf(await openExit(await linkOptions(badWelcome)))).toMatchObject({
      message: DEVICE_CHANNEL_MESSAGES.broke,
    });

    for (const [script, message] of [
      [({ sendRaw }) => Promise.resolve(sendRaw('plain')), DEVICE_CHANNEL_MESSAGES.unsealed],
      [({ close }) => Promise.resolve(close()), DEVICE_CHANNEL_MESSAGES.dropped],
      [({ sendRaw }) => Promise.resolve(sendRaw(new Uint8Array(40))), DEVICE_CHANNEL_MESSAGES.broke],
      [({ sendSealed }) => sendSealed('{"t":"nothing"}'), DEVICE_CHANNEL_MESSAGES.unknown],
      [
        ({ sendSealed }) => sendSealed({ t: 'request', id: '1', method: 'GET', path: '/', headers: [] }),
        DEVICE_CHANNEL_MESSAGES.clientOnly,
      ],
    ] satisfies [Script, string][]) {
      const scripted = await startScripted(script);
      const link = await openLink(await linkOptions(scripted, null));
      expect(await nextClose(link)).toMatchObject({ message });
    }
  });

  test('ignores stray answers and fails a request the machine ended without answering', async () => {
    const scripted = await startScripted(async ({ sendSealed }) => {
      await sendSealed({ t: 'response', id: '9', status: 200, headers: [] });
      await sendSealed({ t: 'body', id: '9', chunk: 'AA' });
      await sendSealed({ t: 'end', id: '9' });
      await Bun.sleep(30);
      await sendSealed({ t: 'end', id: '1' });
    });
    const link = await openLink(await linkOptions(scripted, null));
    const failure = failureOf(
      await runExit(link.request({ method: 'GET', path: '/x', headers: [], body: null }))
    );
    expect(failure).toMatchObject({ message: DEVICE_CHANNEL_MESSAGES.unanswered });
    expect(await Effect.runPromise(link.isOpen)).toBe(true);
  });
});
