import {
  type Bytes,
  type ChannelHeaders,
  parseBase64Url,
  serializeBase64Url,
  TERMINAL_STREAM_CLOSE,
} from '@shinsa/core';
import { openRemoteChannel } from './channel.ts';
import { type DashboardClient, isMachineGone } from './dashboard.ts';
import {
  CHANNEL_REPLACED,
  ChannelError,
  type ChannelOptions,
  type RemoteChannel,
  type TerminalStreamMessage,
} from './remote-channel/schema.ts';
import type { EnrolledDevice } from './schema.ts';

const CONNECTING = 0;

const OPEN = 1;

const CLOSED = 3;

export class ChannelSocket extends EventTarget {
  readyState: number = CONNECTING;
  binaryType: BinaryType = 'blob';
  #channel: RemoteChannel | null = null;
  readonly #release: (() => void)[] = [];

  attach(channel: RemoteChannel) {
    if (this.readyState === CLOSED) {
      channel.close();
      return;
    }
    this.#channel = channel;
    this.#release.push(
      channel.subscribeSocket((data) => this.dispatchEvent(new MessageEvent('message', { data }))),
      channel.subscribeClose((error) => this.#finish(error.message))
    );
    this.readyState = OPEN;
    this.dispatchEvent(new Event('open'));
  }

  send(data: string) {
    if (this.readyState !== OPEN || !this.#channel) return;
    void this.#channel.sendSocket(data);
  }

  close() {
    const channel = this.#channel;
    this.#finish('Closed on this page.');
    channel?.close();
  }

  fail(reason: string) {
    this.#finish(reason);
  }

  #finish(reason: string) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    for (const release of this.#release.splice(0)) release();
    this.#channel = null;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason }));
  }
}

const CHANNEL_GONE = 1006;

let nextStream = 0;

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function toBytes(data: string | ArrayBufferLike | ArrayBufferView) {
  if (typeof data === 'string') return null;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

export class ChannelTerminalSocket extends EventTarget {
  readyState: number = CONNECTING;
  binaryType: BinaryType = 'blob';
  readonly #terminal: string;
  readonly #id: string;
  #channel: RemoteChannel | null = null;
  readonly #release: (() => void)[] = [];

  constructor(terminal: string) {
    super();
    nextStream += 1;
    this.#terminal = terminal;
    this.#id = `t${nextStream}`;
  }

  attach(channel: RemoteChannel) {
    if (this.readyState === CLOSED) return;
    this.#channel = channel;
    this.#release.push(
      channel.subscribeTerminal((message) => this.#receive(message)),
      channel.subscribeClose((error) => this.#finish(CHANNEL_GONE, error.message))
    );
    this.readyState = OPEN;
    void channel.sendTerminal({ t: 'terminal-open', id: this.#id, terminal: this.#terminal });
    this.dispatchEvent(new Event('open'));
  }

  #receive(message: TerminalStreamMessage) {
    if (message.id !== this.#id) return;
    if (message.t === 'terminal-close') {
      this.#finish(message.code, message.reason);
      return;
    }
    const data = message.t === 'terminal-text' ? message.data : parseBase64Url(message.chunk);
    if (data === null) return;
    this.dispatchEvent(
      new MessageEvent('message', { data: typeof data === 'string' ? data : toArrayBuffer(data) })
    );
  }

  send(data: string | ArrayBufferLike | ArrayBufferView) {
    const channel = this.#channel;
    if (this.readyState !== OPEN || !channel) return;
    const bytes = toBytes(data);
    void channel.sendTerminal(
      bytes
        ? { t: 'terminal-bytes', id: this.#id, chunk: serializeBase64Url(bytes as Bytes) }
        : { t: 'terminal-text', id: this.#id, data: data as string }
    );
  }

  close() {
    const channel = this.#channel;
    if (this.readyState === OPEN && channel)
      void channel.sendTerminal({
        t: 'terminal-close',
        id: this.#id,
        code: TERMINAL_STREAM_CLOSE.normal,
        reason: '',
      });
    this.#finish(TERMINAL_STREAM_CLOSE.normal, 'Closed on this page.');
  }

  fail(reason: string) {
    this.#finish(CHANNEL_GONE, reason);
  }

  #finish(code: number, reason: string) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    for (const release of this.#release.splice(0)) release();
    this.#channel = null;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}

export interface RemoteLinkOptions {
  instanceId: string;
  device: EnrolledDevice;
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  onRefused?: (error: ChannelError) => void;
  onRemoved?: () => void;
}

function listRequestHeaders(headers: Headers): ChannelHeaders {
  return [...headers.entries()];
}

export class RemoteLink {
  readonly #options: RemoteLinkOptions;
  #channel: Promise<RemoteChannel> | null = null;
  #current: RemoteChannel | null = null;
  #socketTaken = false;

  constructor(options: RemoteLinkOptions) {
    this.#options = options;
  }

  async #resolveConnectUrl() {
    const answer = await this.#options.dashboard.requestConnect(this.#options.instanceId);
    return answer.url;
  }

  #connect() {
    return (this.#options.openChannel ?? openRemoteChannel)({
      url: this.#resolveConnectUrl(),
      machineKey: this.#options.device.machineKey,
      device: this.#options.device.keys,
      enrollSecret: null,
    });
  }

  #adopt(channel: RemoteChannel, connecting: Promise<RemoteChannel>) {
    if (this.#channel !== connecting) {
      channel.close();
      throw new ChannelError({ message: CHANNEL_REPLACED });
    }
    this.#current = channel;
    channel.subscribeClose(() => {
      if (this.#current === channel) this.#forget();
    });
    return channel;
  }

  #forget() {
    this.#channel = null;
    this.#current = null;
    this.#socketTaken = false;
  }

  resolveChannel(fresh = false) {
    if (fresh) this.close();
    if (!this.#channel) {
      const connecting: Promise<RemoteChannel> = this.#connect().then((channel) =>
        this.#adopt(channel, connecting)
      );
      this.#channel = connecting;
      connecting.catch((error: unknown) => {
        if (this.#channel === connecting) this.#forget();
        if ((error as ChannelError).refused) this.#options.onRefused?.(error as ChannelError);
        if (isMachineGone(error)) this.#options.onRemoved?.();
      });
    }
    return this.#channel;
  }

  openSocket(): WebSocket {
    const socket = new ChannelSocket();
    const connecting = this.resolveChannel(this.#socketTaken);
    this.#socketTaken = true;
    connecting.then(
      (channel) => socket.attach(channel),
      (error: unknown) => socket.fail((error as Error).message)
    );
    return socket as unknown as WebSocket;
  }

  openTerminalSocket(terminal: string): WebSocket {
    const socket = new ChannelTerminalSocket(terminal);
    this.resolveChannel().then(
      (channel) => socket.attach(channel),
      (error: unknown) => socket.fail((error as Error).message)
    );
    return socket as unknown as WebSocket;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    let body: Bytes | null = null;
    if (hasBody) body = new Uint8Array(await request.arrayBuffer());
    const channel = await this.resolveChannel();
    return channel.request({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: listRequestHeaders(request.headers),
      body,
      signal: request.signal,
    });
  }

  close() {
    const current = this.#current;
    this.#forget();
    current?.close();
  }
}
