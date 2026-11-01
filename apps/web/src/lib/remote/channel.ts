import {
  type Bytes,
  CHANNEL_COMPRESSION,
  type ChannelHeaders,
  type ChannelMessage,
  createClientHello,
  createEnrollProof,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveClientSession,
  encodeText,
  listBodyMessages,
  parseBodyChunk,
  parseChannelMessage,
  parsePublicKey,
  parseServerHello,
  REMOTE_KEY_ALGORITHM,
  serializeChannelMessage,
  serializePublicKey,
} from '@shinsa/core';

export interface ChannelOptions {
  url: string;
  machineKey: string;
  device: CryptoKeyPair;
  enrollSecret: string | null;
  name?: string | null;
  onPending?: () => void;
  openSocket?: (url: string) => WebSocket;
}

export interface ChannelRequest {
  method: string;
  path: string;
  headers: ChannelHeaders;
  body: Bytes | null;
  signal?: AbortSignal;
}

export class ChannelError extends Error {
  readonly refused: boolean;

  constructor(message: string, refused = false) {
    super(message);
    this.name = 'ChannelError';
    this.refused = refused;
  }
}

interface PendingResponse {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  stream: ReadableStreamDefaultController<Uint8Array> | null;
}

type Phase =
  | { kind: 'hello'; finish: (welcome: string) => Promise<void> }
  | { kind: 'open'; seal: (plain: Bytes) => Promise<Bytes>; open: (frame: Bytes) => Promise<Bytes> }
  | { kind: 'closed' };

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function openBrowserSocket(url: string) {
  return new WebSocket(url);
}

function toBytes(data: unknown): Bytes | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return new Uint8Array(data);
  return null;
}

export class RemoteChannel {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, PendingResponse>();
  readonly #socketListeners = new Set<(data: string) => void>();
  readonly #closeListeners = new Set<(error: ChannelError) => void>();
  readonly #readyListeners = new Set<() => void>();
  #phase: Phase;
  #queue: Promise<void> = Promise.resolve();
  #nextId = 0;
  #confirmed = false;

  constructor(socket: WebSocket, finish: (channel: RemoteChannel, welcome: string) => Promise<void>) {
    this.#socket = socket;
    this.#phase = { kind: 'hello', finish: (welcome) => finish(this, welcome) };
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      this.#queue = this.#queue
        .then(() => this.#receive(event.data))
        .catch((error: unknown) => {
          this.fail(
            error instanceof ChannelError ? error : new ChannelError('The connection to your machine broke.')
          );
        });
    });
    socket.addEventListener('close', (event) => {
      this.fail(new ChannelError(event.reason || 'The connection to your machine closed.'));
    });
  }

  get isClosed() {
    return this.#phase.kind === 'closed';
  }

  get isOpen() {
    return this.#phase.kind === 'open' && this.#confirmed;
  }

  attach(seal: (plain: Bytes) => Promise<Bytes>, open: (frame: Bytes) => Promise<Bytes>) {
    if (this.#phase.kind === 'closed') return;
    this.#phase = { kind: 'open', seal, open };
  }

  async #receive(data: unknown) {
    const phase = this.#phase;
    if (phase.kind === 'closed') return;
    if (phase.kind === 'hello') {
      if (typeof data !== 'string') throw new ChannelError('Your machine answered without a handshake.');
      await phase.finish(data);
      return;
    }
    const frame = toBytes(data);
    if (!frame) throw new ChannelError('Your machine sent an unsealed message.');
    const message = parseChannelMessage(decodeText(await phase.open(frame)));
    if (!message) throw new ChannelError('Your machine sent a message this page does not know.');
    this.#handle(message);
  }

  #handle(message: ChannelMessage) {
    switch (message.t) {
      case 'ready':
        this.#confirmed = true;
        for (const listener of this.#readyListeners) listener();
        return;
      case 'socket':
        for (const listener of this.#socketListeners) listener(message.data);
        return;
      case 'response':
        this.#startResponse(message);
        return;
      case 'body':
        this.#appendBody(message.id, message.chunk);
        return;
      case 'end':
        this.#endResponse(message.id);
        return;
      default:
        throw new ChannelError('Your machine sent a message only a browser sends.');
    }
  }

  #startResponse(message: Extract<ChannelMessage, { t: 'response' }>) {
    const pending = this.#pending.get(message.id);
    if (!pending || pending.stream) return;
    if (NULL_BODY_STATUSES.has(message.status)) {
      pending.resolve(new Response(null, { status: message.status, headers: message.headers }));
      this.#pending.delete(message.id);
      return;
    }
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        pending.stream = controller;
      },
    });
    pending.resolve(new Response(body, { status: message.status, headers: message.headers }));
  }

  #appendBody(id: string, chunk: string) {
    const bytes = parseBodyChunk(chunk);
    const stream = this.#pending.get(id)?.stream;
    if (stream && bytes) stream.enqueue(bytes);
  }

  #endResponse(id: string) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (pending.stream) pending.stream.close();
    else pending.reject(new ChannelError('Your machine ended a request without answering it.'));
  }

  async send(message: ChannelMessage) {
    const phase = this.#phase;
    if (phase.kind !== 'open') throw new ChannelError('The connection to your machine is closed.');
    const frame = await phase.seal(encodeText(serializeChannelMessage(message)));
    if (this.#phase.kind === 'open') this.#socket.send(frame);
  }

  sendText(text: string) {
    this.#socket.send(text);
  }

  sendSocket(data: string) {
    return this.send({ t: 'socket', data });
  }

  subscribeSocket(listener: (data: string) => void) {
    this.#socketListeners.add(listener);
    return () => {
      this.#socketListeners.delete(listener);
    };
  }

  subscribeReady(listener: () => void) {
    this.#readyListeners.add(listener);
  }

  subscribeClose(listener: (error: ChannelError) => void) {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  async request(input: ChannelRequest): Promise<Response> {
    if (!this.isOpen) throw new ChannelError('The connection to your machine is closed.');
    this.#nextId += 1;
    const id = String(this.#nextId);
    const answer = Promise.withResolvers<Response>();
    this.#pending.set(id, { resolve: answer.resolve, reject: answer.reject, stream: null });
    input.signal?.addEventListener(
      'abort',
      () => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        const error = new DOMException('The request was aborted.', 'AbortError');
        pending.reject(error);
        pending.stream?.error(error);
        if (this.#phase.kind === 'open') void this.send({ t: 'abort', id });
      },
      { once: true }
    );
    await this.send({ t: 'request', id, method: input.method, path: input.path, headers: input.headers });
    for (const message of listBodyMessages(id, input.body ?? new Uint8Array())) await this.send(message);
    return answer.promise;
  }

  fail(error: ChannelError) {
    if (this.#phase.kind === 'closed') return;
    this.#phase = { kind: 'closed' };
    for (const pending of this.#pending.values()) {
      pending.reject(error);
      pending.stream?.error(error);
    }
    this.#pending.clear();
    if (this.#socket.readyState === WebSocket.CONNECTING || this.#socket.readyState === WebSocket.OPEN)
      this.#socket.close(1000);
    for (const listener of this.#closeListeners) listener(error);
  }

  close() {
    this.fail(new ChannelError('The connection to your machine was closed on this page.'));
  }
}

function awaitOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('close', () => reject(new ChannelError('Couldn’t reach your machine.')), {
      once: true,
    });
  });
}

export async function openRemoteChannel(options: ChannelOptions): Promise<RemoteChannel> {
  const machinePublicKey = await parsePublicKey(options.machineKey);
  if (!machinePublicKey) throw new ChannelError('The key this browser pinned for your machine is not valid.');
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const device = await serializePublicKey(options.device.publicKey);
  const clientEphemeral = await serializePublicKey(ephemeral.publicKey);
  let enroll: string | null = null;
  if (options.enrollSecret)
    enroll = await createEnrollProof(options.enrollSecret, {
      machine: options.machineKey,
      device,
      clientEphemeral,
    });
  const hello = await createClientHello(
    options.device.publicKey,
    ephemeral.publicKey,
    enroll,
    options.name ?? null,
    [CHANNEL_COMPRESSION]
  );
  const socket = (options.openSocket ?? openBrowserSocket)(options.url);
  const channel = new RemoteChannel(socket, async (opened, text) => {
    const welcome = parseServerHello(text);
    if (welcome?.type === 'refused') throw new ChannelError(welcome.reason, true);
    if (welcome?.type === 'pending') {
      options.onPending?.();
      return;
    }
    if (!welcome) throw new ChannelError('Your machine answered the handshake with something else.');
    const session = await deriveClientSession({
      keys: {
        machine: options.machineKey,
        device,
        clientEphemeral,
        serverEphemeral: welcome.ephemeral,
      },
      machinePublicKey,
      devicePrivateKey: options.device.privateKey,
      clientEphemeralPrivateKey: ephemeral.privateKey,
    });
    opened.attach(
      createFrameSealer(session.send, welcome.compression),
      createFrameOpener(session.receive, welcome.compression)
    );
    await opened.send({ t: 'ready' });
  });
  await awaitOpen(socket);
  await new Promise<void>((resolve, reject) => {
    channel.subscribeReady(resolve);
    channel.subscribeClose(reject);
    channel.sendText(JSON.stringify(hello));
  });
  return channel;
}
