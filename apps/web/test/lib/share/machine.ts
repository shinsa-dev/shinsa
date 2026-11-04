import {
  type Bytes,
  createFrameSealer,
  createShareWelcome,
  deriveShareSessionKey,
  encodeText,
  parseShareHello,
  REMOTE_KEY_ALGORITHM,
  type ShareFileType,
  type ShareLink,
  type ShareLiveView,
  type ShareMessage,
  serializeBase64Url,
  serializePublicKey,
  serializeShareMessage,
  verifyShareHello,
} from '@shinsa/core';
import { Effect } from 'effect';
import type { Socket } from 'effect/socket';
import type { ShareStreamOptions } from '@/lib/share/live.ts';
import { createSocketTransport, type PendingRetry } from '../../support/engine-socket.ts';

export const SHARE_LINK: ShareLink = {
  instanceId: 'k3x9',
  shareId: 'BwcHBwcHBwcHBwcHBwcHBw',
  key: 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk',
};

type Listener = (event: Socket.WebSocketEvent) => void;

class FakeShareSocket implements Socket.WebSocketLike {
  binaryType = 'blob';
  readyState = 0;
  closed = false;
  readonly url: string;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: string[] = [];
  readonly #machine: FakeShareMachine;

  constructor(url: string, machine: FakeShareMachine) {
    this.url = url;
    this.#machine = machine;
    queueMicrotask(() => this.emit(machine.refuseOpen ? 'close' : 'open', {}));
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((known) => known !== listener)
    );
  }

  emit(type: string, event: Socket.WebSocketEvent) {
    if (type === 'open') this.readyState = 1;
    if (type === 'close') this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string | Uint8Array) {
    if (typeof data !== 'string') return;
    this.sent.push(data);
    void this.#machine.answer(this, data);
  }

  close() {
    this.closed = true;
  }
}

export interface FakeShareMachine {
  sockets: FakeShareSocket[];
  online: boolean;
  refuseOpen: boolean;
  status: number;
  key: string;
  seal: ((plain: Bytes) => Promise<Bytes>) | null;
  answer: (socket: FakeShareSocket, data: string) => Promise<void>;
  ready: Promise<void>;
  send: (message: ShareMessage) => Promise<void>;
  sendView: (view: ShareLiveView) => Promise<void>;
  sendFile: (id: string, version: string, type: ShareFileType, text: string) => Promise<void>;
  latest: () => FakeShareSocket;
  createSocket: (url: string) => FakeShareSocket;
  options: Required<Pick<ShareStreamOptions, 'fetch' | 'transport' | 'createUrl' | 'revokeUrl'>>;
  waits: PendingRetry[];
  revoked: string[];
}

export function createFakeShareMachine(): FakeShareMachine {
  let readied: () => void = () => undefined;
  let blobs = 0;
  const waits: PendingRetry[] = [];
  const machine: FakeShareMachine = {
    sockets: [],
    online: true,
    refuseOpen: false,
    status: 200,
    key: SHARE_LINK.key,
    seal: null,
    ready: new Promise((resolve) => {
      readied = resolve;
    }),
    waits,
    revoked: [],
    latest: () => {
      const socket = machine.sockets.at(-1);
      if (!socket) throw new Error('No socket was opened.');
      return socket;
    },
    answer: async (socket, data) => {
      const hello = parseShareHello(data);
      if (!(hello && (await Effect.runPromise(verifyShareHello(machine.key, hello))))) {
        socket.emit('message', { data: JSON.stringify({ type: 'refused', reason: 'Wrong key.' }) });
        return;
      }
      const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
      const keys = {
        share: hello.share,
        clientEphemeral: hello.ephemeral,
        serverEphemeral: await Effect.runPromise(serializePublicKey(ephemeral.publicKey)),
      };
      const session = await Effect.runPromise(
        deriveShareSessionKey(machine.key, keys, ephemeral.privateKey, hello.ephemeral)
      );
      const seal = createFrameSealer(session);
      machine.seal = (plain) => Effect.runPromise(seal(plain));
      socket.emit('message', {
        data: JSON.stringify(await Effect.runPromise(createShareWelcome(machine.key, keys))),
      });
      readied();
    },
    send: async (message) => {
      if (!machine.seal) throw new Error('The share link is not open.');
      const frame = await machine.seal(encodeText(serializeShareMessage(message)));
      machine.latest().emit('message', { data: frame.buffer });
    },
    sendView: (view) => machine.send({ t: 'view', data: JSON.stringify(view) }),
    sendFile: async (id, version, type, text) => {
      await machine.send({ t: 'file', id, version, type });
      await machine.send({ t: 'body', id, chunk: serializeBase64Url(encodeText(text)) });
      await machine.send({ t: 'end', id });
    },
    createSocket: (url) => {
      const socket = new FakeShareSocket(url, machine);
      machine.sockets.push(socket);
      return socket;
    },
    options: {
      fetch: () => {
        if (machine.status !== 200) return Promise.resolve(new Response('', { status: machine.status }));
        return Promise.resolve(Response.json({ url: 'wss://t-k3x9.shinsa.dev', online: machine.online }));
      },
      transport: createSocketTransport((url) => machine.createSocket(url), waits),
      createUrl: () => {
        blobs += 1;
        return `blob:share-${blobs}`;
      },
      revokeUrl: (url) => {
        machine.revoked.push(url);
      },
    },
  };
  return machine;
}
