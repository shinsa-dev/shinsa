import {
  type Bytes,
  type ChannelMessage,
  concatBytes,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveServerSession,
  encodeText,
  listBodyMessages,
  parseBodyChunk,
  parseChannelMessage,
  parseClientHello,
  REMOTE_KEY_ALGORITHM,
  serializeChannelMessage,
  serializePublicKey,
  verifyEnrollProof,
} from '@shinsa/core';

export async function createKeyPair() {
  return (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
}

export interface FakeMacOptions {
  enrolled?: string[];
  enrollSecret?: string | null;
  respond?: (request: Request) => Promise<Response> | Response;
  welcome?: (text: string) => string | null;
  refuseOpen?: boolean;
  tolerant?: boolean;
}

interface Collecting {
  method: string;
  path: string;
  headers: [string, string][];
  chunks: Bytes[];
}

export class FakeMac {
  readonly machine: CryptoKeyPair;
  readonly machineKey: string;
  readonly enrolled: Set<string>;
  readonly socketMessages: string[] = [];
  readonly aborted: string[] = [];
  readonly received: ChannelMessage[] = [];
  readonly urls: string[] = [];
  sockets: FakeMacSocket[] = [];
  options: FakeMacOptions;

  private constructor(machine: CryptoKeyPair, machineKey: string, options: FakeMacOptions) {
    this.machine = machine;
    this.machineKey = machineKey;
    this.enrolled = new Set(options.enrolled ?? []);
    this.options = options;
  }

  static async create(options: FakeMacOptions = {}) {
    const machine = await createKeyPair();
    return new FakeMac(machine, await serializePublicKey(machine.publicKey), options);
  }

  openSocket = (url: string) => {
    this.urls.push(url);
    const socket = new FakeMacSocket(this);
    this.sockets.push(socket);
    return socket as unknown as WebSocket;
  };

  get last() {
    return this.sockets.at(-1) as FakeMacSocket;
  }
}

export class FakeMacSocket extends EventTarget {
  readyState = 0;
  binaryType: BinaryType = 'blob';
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;
  readonly sentText: string[] = [];
  readonly #mac: FakeMac;
  #seal: ((plain: Bytes) => Promise<Bytes>) | null = null;
  #open: ((frame: Bytes) => Promise<Bytes>) | null = null;
  #queue: Promise<void> = Promise.resolve();
  readonly #requests = new Map<string, Collecting>();

  constructor(mac: FakeMac) {
    super();
    this.#mac = mac;
    queueMicrotask(() => {
      if (mac.options.refuseOpen) {
        this.drop('refused');
        return;
      }
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: string | Bytes) {
    this.#queue = this.#queue
      .then(() => this.#receive(data))
      .catch(() => {
        if (!this.#mac.options.tolerant) this.drop('The machine could not open a frame.');
      });
  }

  close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  drop(reason = '') {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1006, reason }));
  }

  deliver(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  async sealed(message: ChannelMessage) {
    const frame = await (this.#seal as (plain: Bytes) => Promise<Bytes>)(
      encodeText(serializeChannelMessage(message))
    );
    this.deliver(frame.buffer);
  }

  async sealedText(text: string) {
    const frame = await (this.#seal as (plain: Bytes) => Promise<Bytes>)(encodeText(text));
    this.deliver(frame.buffer);
  }

  async #receive(data: string | Bytes) {
    if (typeof data === 'string') {
      this.sentText.push(data);
      await this.#handshake(data);
      return;
    }
    const message = parseChannelMessage(decodeText(await (this.#open as (f: Bytes) => Promise<Bytes>)(data)));
    if (!message) return;
    this.#mac.received.push(message);
    await this.#handle(message);
  }

  async #handshake(text: string) {
    const mac = this.#mac;
    const hello = parseClientHello(text);
    if (!hello) return;
    const keys = { machine: mac.machineKey, device: hello.device, clientEphemeral: hello.ephemeral };
    const secret = mac.options.enrollSecret;
    let redeemed = false;
    if (hello.enroll !== null && secret) redeemed = await verifyEnrollProof(secret, hello.enroll, keys);
    if (!(mac.enrolled.has(hello.device) || redeemed)) {
      this.deliver(
        JSON.stringify({ type: 'refused', reason: 'This browser is not enrolled on this machine.' })
      );
      return;
    }
    if (redeemed) mac.enrolled.add(hello.device);
    const ephemeral = await createKeyPair();
    const serverEphemeral = await serializePublicKey(ephemeral.publicKey);
    const session = await deriveServerSession({
      keys: { ...keys, serverEphemeral },
      machinePrivateKey: mac.machine.privateKey,
      serverEphemeralPrivateKey: ephemeral.privateKey,
    });
    this.#seal = createFrameSealer(session.send);
    this.#open = createFrameOpener(session.receive);
    const welcome = JSON.stringify({ type: 'welcome', ephemeral: serverEphemeral });
    this.deliver(mac.options.welcome?.(welcome) ?? welcome);
    await this.sealed({ t: 'ready' });
  }

  async #handle(message: ChannelMessage) {
    switch (message.t) {
      case 'socket':
        this.#mac.socketMessages.push(message.data);
        await this.sealed({ t: 'socket', data: `echo:${message.data}` });
        return;
      case 'request':
        this.#requests.set(message.id, { ...message, chunks: [] });
        return;
      case 'body': {
        const bytes = parseBodyChunk(message.chunk);
        if (bytes) this.#requests.get(message.id)?.chunks.push(bytes);
        return;
      }
      case 'end':
        await this.#answer(message.id);
        return;
      case 'abort':
        this.#mac.aborted.push(message.id);
        return;
      default:
        return;
    }
  }

  async #answer(id: string) {
    const open = this.#requests.get(id);
    const respond = this.#mac.options.respond;
    if (!(open && respond)) return;
    const hasBody = open.method !== 'GET' && open.method !== 'HEAD';
    const response = await respond(
      new Request(`http://mac${open.path}`, {
        method: open.method,
        headers: open.headers,
        ...(hasBody ? { body: concatBytes(...open.chunks) } : {}),
      })
    );
    await this.sealed({
      t: 'response',
      id,
      status: response.status,
      headers: [...response.headers.entries()],
    });
    const body = new Uint8Array(await response.arrayBuffer());
    for (const part of listBodyMessages(id, body)) await this.sealed(part);
  }
}
