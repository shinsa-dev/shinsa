import { type Bytes, type ChannelHeaders, CONNECT_TOKEN_TTL_MS, type ConnectResponse } from '@shinsa/core';
import { ChannelError, type ChannelOptions, openRemoteChannel, type RemoteChannel } from './channel.ts';
import { type DashboardClient, DashboardError } from './dashboard.ts';
import type { EnrolledDevice } from './devices.ts';

const CONNECTING = 0;

const OPEN = 1;

const CLOSED = 3;

const CONNECT_TOKEN_MARGIN_MS = 20_000;

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

export interface RemoteLinkOptions {
  instanceId: string;
  device: EnrolledDevice;
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  onRefused?: (error: ChannelError) => void;
  now?: () => number;
  onRemoved?: () => void;
}

interface HeldConnect {
  url: string;
  reusableUntil: number;
}

function isRemoved(error: unknown) {
  return error instanceof DashboardError && error.status === 404;
}

function listRequestHeaders(headers: Headers): ChannelHeaders {
  return [...headers.entries()];
}

export class RemoteLink {
  readonly #options: RemoteLinkOptions;
  #channel: Promise<RemoteChannel> | null = null;
  #current: RemoteChannel | null = null;
  #socketTaken = false;
  #connectHeld: HeldConnect | null = null;

  constructor(options: RemoteLinkOptions) {
    this.#options = options;
  }

  #now() {
    return (this.#options.now ?? Date.now)();
  }

  async #resolveConnectUrl() {
    const held = this.#connectHeld;
    if (held && this.#now() < held.reusableUntil) return held.url;
    this.#connectHeld = null;
    const requestedAt = this.#now();
    const answer: ConnectResponse = await this.#options.dashboard.requestConnect(this.#options.instanceId);
    const reusableUntil =
      Math.min(answer.expiresAt, requestedAt + CONNECT_TOKEN_TTL_MS) - CONNECT_TOKEN_MARGIN_MS;
    if (requestedAt < reusableUntil) this.#connectHeld = { url: answer.url, reusableUntil };
    return answer.url;
  }

  async #connect() {
    try {
      return await (this.#options.openChannel ?? openRemoteChannel)({
        url: this.#resolveConnectUrl(),
        machineKey: this.#options.device.machineKey,
        device: this.#options.device.keys,
        enrollSecret: null,
      });
    } catch (error) {
      this.#connectHeld = null;
      throw error;
    }
  }

  #adopt(channel: RemoteChannel, connecting: Promise<RemoteChannel>) {
    if (this.#channel !== connecting) {
      channel.close();
      throw new ChannelError('A newer connection to your machine replaced this one.');
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
        if (isRemoved(error)) this.#options.onRemoved?.();
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
