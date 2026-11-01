import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  type ChannelHeaders,
  type ChannelMessage,
  type ClientHello,
  concatBytes,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveServerSession,
  encodeText,
  type HandshakeKeys,
  parseBodyChunk,
  parseChannelMessage,
  parseClientHello,
  REMOTE_KEY_ALGORITHM,
  type ServerHello,
  serializeBase64Url,
  serializeChannelMessage,
  serializePublicKey,
} from '@shinsa/core';
import type { HubSocket } from '../http/socket.ts';
import { describeError, log } from '../log/index.ts';

const CHANNEL_REQUEST_ORIGIN = 'http://remote.shinsa.internal';

const MAX_OPEN_REQUESTS = 32;

const POLICY_VIOLATION = 1008;

const DROPPED_HEADERS = new Set(['host', 'connection', 'cookie', 'origin', 'content-length', 'upgrade']);

export interface ChannelPeer {
  send: (data: string | Bytes) => void;
  close: (code: number, reason: string) => void;
}

interface ChannelHub {
  open: (socket: HubSocket) => void;
  close: (socket: HubSocket) => void;
  message: (socket: HubSocket, raw: string) => void;
}

export type AccessAnswer =
  | { kind: 'refused'; reason: string }
  | { kind: 'admitted' }
  | { kind: 'waiting'; decided: Promise<boolean> };

export interface ChannelHost {
  resolveMachineKey: () => Promise<{ publicKey: string; privateKey: CryptoKey }>;
  isEnrolled: (device: string) => boolean;
  requestAccess: (
    proof: string,
    keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>,
    name: string | null
  ) => Promise<AccessAnswer>;
  resumeAccess: (device: string) => AccessAnswer | null;
  recordSeen: (device: string) => void;
  hub: ChannelHub;
  respond: (request: Request) => Promise<Response>;
  maxBodyBytes: number;
}

interface OpenRequest {
  method: string;
  path: string;
  headers: ChannelHeaders;
  chunks: Bytes[];
  size: number;
  controller: AbortController;
  sent: boolean;
}

type ChannelState =
  | { kind: 'hello' }
  | {
      kind: 'open';
      device: string;
      seal: (plain: Bytes) => Promise<Bytes>;
      open: (frame: Bytes) => Promise<Bytes>;
      socket: HubSocket | null;
    }
  | { kind: 'closed' };

function isSafePath(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

function listForwardedHeaders(headers: ChannelHeaders) {
  return headers.filter(([name]) => {
    const lower = name.toLowerCase();
    return !DROPPED_HEADERS.has(lower) && !lower.startsWith('sec-');
  });
}

function toBytes(raw: string | Bytes | ArrayBuffer | Uint8Array): Bytes | null {
  if (typeof raw === 'string') return null;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw);
}

export class RemoteChannel {
  readonly #peer: ChannelPeer;
  readonly #host: ChannelHost;
  readonly #requests = new Map<string, OpenRequest>();
  #state: ChannelState = { kind: 'hello' };
  #queue: Promise<void> = Promise.resolve();

  constructor(peer: ChannelPeer, host: ChannelHost) {
    this.#peer = peer;
    this.#host = host;
  }

  get device() {
    return this.#state.kind === 'open' ? this.#state.device : null;
  }

  get isOpen() {
    return this.#state.kind === 'open';
  }

  receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    this.#queue = this.#queue.then(async () => {
      try {
        await this.#receive(raw);
      } catch (error) {
        this.fail('The channel broke.', error);
      }
    });
    return this.#queue;
  }

  async #receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    const state = this.#state;
    if (state.kind === 'closed') return;
    if (state.kind === 'hello') {
      const hello = typeof raw === 'string' ? parseClientHello(raw) : null;
      if (!hello) {
        this.fail('The channel expects a hello first.');
        return;
      }
      await this.#handshake(hello);
      return;
    }
    const frame = toBytes(raw);
    if (!frame) {
      this.fail('A sealed channel only carries sealed frames.');
      return;
    }
    const message = parseChannelMessage(decodeText(await state.open(frame)));
    if (!message) {
      this.fail('A sealed frame held no channel message.');
      return;
    }
    this.#handle(message);
  }

  #refuse(reason: string) {
    this.#peer.send(JSON.stringify({ type: 'refused', reason } satisfies ServerHello));
    this.fail(reason);
  }

  #requestAnswer(hello: ClientHello, keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>) {
    if (hello.enroll === null) return Promise.resolve(this.#host.resumeAccess(hello.device));
    return this.#host.requestAccess(hello.enroll, keys, hello.name);
  }

  async #awaitAccess(
    hello: ClientHello,
    keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>
  ) {
    const answer = await this.#requestAnswer(hello, keys);
    if (answer === null) {
      this.#refuse('This device is not added to this machine. Ask for access with its link first.');
      return false;
    }
    if (answer.kind === 'refused') {
      this.#refuse(answer.reason);
      return false;
    }
    if (answer.kind === 'admitted') return true;
    this.#peer.send(JSON.stringify({ type: 'pending' } satisfies ServerHello));
    const approved = await answer.decided;
    if (this.#state.kind === 'closed') return false;
    if (!approved) this.#refuse('Your request to reach this machine was declined.');
    return approved;
  }

  async #handshake(hello: ClientHello) {
    const machine = await this.#host.resolveMachineKey();
    const keys = { machine: machine.publicKey, device: hello.device, clientEphemeral: hello.ephemeral };
    if (!this.#host.isEnrolled(hello.device) && !(await this.#awaitAccess(hello, keys))) return;
    const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const serverEphemeral = await serializePublicKey(ephemeral.publicKey);
    const session = await deriveServerSession({
      keys: { ...keys, serverEphemeral },
      machinePrivateKey: machine.privateKey,
      serverEphemeralPrivateKey: ephemeral.privateKey,
    });
    if (this.#state.kind === 'closed') return;
    this.#state = {
      kind: 'open',
      device: hello.device,
      seal: createFrameSealer(session.send),
      open: createFrameOpener(session.receive),
      socket: null,
    };
    this.#peer.send(JSON.stringify({ type: 'welcome', ephemeral: serverEphemeral } satisfies ServerHello));
    this.#host.recordSeen(hello.device);
    void this.#send({ t: 'ready' });
  }

  #send(message: ChannelMessage) {
    const state = this.#state;
    if (state.kind !== 'open') return Promise.resolve();
    return state.seal(encodeText(serializeChannelMessage(message))).then((frame) => {
      if (this.#state.kind === 'open') this.#peer.send(frame);
    });
  }

  #handle(message: ChannelMessage) {
    const state = this.#state;
    if (state.kind !== 'open') return;
    switch (message.t) {
      case 'ready':
        if (state.socket) return;
        state.socket = this.#createSocket();
        this.#host.hub.open(state.socket);
        return;
      case 'socket':
        if (state.socket) this.#host.hub.message(state.socket, message.data);
        return;
      case 'request':
        this.#startRequest(message);
        return;
      case 'body':
        this.#appendBody(message.id, message.chunk);
        return;
      case 'end':
        void this.#finishRequest(message.id);
        return;
      case 'abort':
        this.#requests.get(message.id)?.controller.abort();
        this.#requests.delete(message.id);
        return;
      case 'response':
        this.fail('The browser cannot send a response.');
        return;
    }
  }

  #createSocket(): HubSocket {
    return {
      data: { kind: 'hub', transcripts: new Map(), surface: null, origin: 'remote' },
      send: (payload: string) => this.#send({ t: 'socket', data: payload }),
    };
  }

  #startRequest(message: Extract<ChannelMessage, { t: 'request' }>) {
    if (this.#requests.has(message.id) || !isSafePath(message.path)) {
      this.fail('A request was not valid.');
      return;
    }
    if (this.#requests.size >= MAX_OPEN_REQUESTS) {
      void this.#respondStatus(message.id, 429);
      return;
    }
    this.#requests.set(message.id, {
      method: message.method,
      path: message.path,
      headers: listForwardedHeaders(message.headers),
      chunks: [],
      size: 0,
      controller: new AbortController(),
      sent: false,
    });
  }

  #appendBody(id: string, chunk: string) {
    const request = this.#requests.get(id);
    const bytes = parseBodyChunk(chunk);
    if (!request || request.sent || !bytes) return;
    request.size += bytes.length;
    if (request.size > this.#host.maxBodyBytes) {
      this.#requests.delete(id);
      void this.#respondStatus(id, 413);
      return;
    }
    request.chunks.push(bytes);
  }

  async #respondStatus(id: string, status: number) {
    await this.#send({ t: 'response', id, status, headers: [] });
    await this.#send({ t: 'end', id });
  }

  async #finishRequest(id: string) {
    const open = this.#requests.get(id);
    if (!open || open.sent) return;
    open.sent = true;
    const hasBody = open.method !== 'GET' && open.method !== 'HEAD';
    const request = new Request(`${CHANNEL_REQUEST_ORIGIN}${open.path}`, {
      method: open.method,
      headers: [
        ...open.headers,
        ...(hasBody ? [['content-length', String(open.size)] as [string, string]] : []),
      ],
      ...(hasBody ? { body: concatBytes(...open.chunks) } : {}),
      signal: open.controller.signal,
    });
    try {
      const response = await this.#host.respond(request);
      await this.#streamResponse(id, open, response);
    } catch (error) {
      if (!open.controller.signal.aborted) {
        log.warn('[Remote] A remote request failed', { path: open.path, error: describeError(error) });
        await this.#respondStatus(id, 500);
      }
    } finally {
      this.#requests.delete(id);
    }
  }

  async #streamResponse(id: string, open: OpenRequest, response: Response) {
    await this.#send({
      t: 'response',
      id,
      status: response.status,
      headers: [...response.headers.entries()],
    });
    if (response.body) {
      const reader = response.body.getReader();
      open.controller.signal.addEventListener('abort', () => void reader.cancel(), { once: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done || open.controller.signal.aborted || this.#state.kind !== 'open') break;
        for (let offset = 0; offset < value.length; offset += CHANNEL_BODY_CHUNK_BYTES) {
          const chunk = serializeBase64Url(value.slice(offset, offset + CHANNEL_BODY_CHUNK_BYTES) as Bytes);
          await this.#send({ t: 'body', id, chunk });
        }
      }
    }
    if (!open.controller.signal.aborted) await this.#send({ t: 'end', id });
  }

  fail(reason: string, error?: unknown) {
    if (this.#state.kind === 'closed') return;
    if (error) log.warn('[Remote] Closing a remote channel', { reason, error: describeError(error) });
    this.#peer.close(POLICY_VIOLATION, reason);
    this.close();
  }

  close() {
    const state = this.#state;
    this.#state = { kind: 'closed' };
    if (state.kind === 'open' && state.socket) this.#host.hub.close(state.socket);
    for (const request of this.#requests.values()) request.controller.abort();
    this.#requests.clear();
  }
}
