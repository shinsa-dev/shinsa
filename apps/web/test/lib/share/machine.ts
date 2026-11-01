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
import type { ShareSocket, ShareStreamOptions } from '@/lib/share/live.ts';

export const SHARE_LINK: ShareLink = {
  instanceId: 'k3x9',
  shareId: 'BwcHBwcHBwcHBwcHBwcHBw',
  key: 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk',
};

type Listener = (event: { data?: unknown }) => void;

class FakeShareSocket implements ShareSocket {
  binaryType = 'blob';
  closed = false;
  readonly url: string;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: string[] = [];
  readonly #machine: FakeShareMachine;

  constructor(url: string, machine: FakeShareMachine) {
    this.url = url;
    this.#machine = machine;
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string) {
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
  status: number;
  key: string;
  seal: ((plain: Bytes) => Promise<Bytes>) | null;
  answer: (socket: FakeShareSocket, data: string) => Promise<void>;
  ready: Promise<void>;
  send: (message: ShareMessage) => Promise<void>;
  sendView: (view: ShareLiveView) => Promise<void>;
  sendFile: (id: string, version: string, type: ShareFileType, text: string) => Promise<void>;
  latest: () => FakeShareSocket;
  options: Required<Pick<ShareStreamOptions, 'fetch' | 'createSocket' | 'createUrl' | 'revokeUrl' | 'wait'>>;
  waits: (() => void)[];
  revoked: string[];
}

export function createFakeShareMachine(): FakeShareMachine {
  let readied: () => void = () => undefined;
  let blobs = 0;
  const machine: FakeShareMachine = {
    sockets: [],
    online: true,
    status: 200,
    key: SHARE_LINK.key,
    seal: null,
    ready: new Promise((resolve) => {
      readied = resolve;
    }),
    waits: [],
    revoked: [],
    latest: () => {
      const socket = machine.sockets.at(-1);
      if (!socket) throw new Error('No socket was opened.');
      return socket;
    },
    answer: async (socket, data) => {
      const hello = parseShareHello(data);
      if (!(hello && (await verifyShareHello(machine.key, hello)))) {
        socket.emit('message', { data: JSON.stringify({ type: 'refused', reason: 'Wrong key.' }) });
        return;
      }
      const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
      const keys = {
        share: hello.share,
        clientEphemeral: hello.ephemeral,
        serverEphemeral: await serializePublicKey(ephemeral.publicKey),
      };
      const session = await deriveShareSessionKey(machine.key, keys, ephemeral.privateKey, hello.ephemeral);
      machine.seal = createFrameSealer(session);
      socket.emit('message', { data: JSON.stringify(await createShareWelcome(machine.key, keys)) });
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
    options: {
      fetch: (() => {
        if (machine.status !== 200) return Promise.resolve(new Response('', { status: machine.status }));
        return Promise.resolve(Response.json({ url: 'wss://t-k3x9.shinsa.dev', online: machine.online }));
      }) as unknown as typeof fetch,
      createSocket: (url) => {
        const socket = new FakeShareSocket(url, machine);
        machine.sockets.push(socket);
        return socket;
      },
      createUrl: () => {
        blobs += 1;
        return `blob:share-${blobs}`;
      },
      revokeUrl: (url) => {
        machine.revoked.push(url);
      },
      wait: (_ms, run) => {
        machine.waits.push(run);
        return () => undefined;
      },
    },
  };
  return machine;
}
