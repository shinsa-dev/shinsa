import {
  type Bytes,
  concatBytes,
  createFrameOpener,
  createShareHello,
  decodeText,
  deriveShareSessionKey,
  parseBodyChunk,
  parseShareMessage,
  parseShareWelcome,
  REMOTE_KEY_ALGORITHM,
  resolveShareChannelUrl,
  resolveShareConnectPath,
  type ShareConnectResponse,
  type ShareFileType,
  type ShareLink,
  type ShareLiveView,
  type ShareMessage,
  verifyShareWelcome,
} from '@shinsa/core';
import { ShareGoneError } from '@/lib/share/sources.ts';
import type { SharedSource } from '@/lib/share/view.ts';

export const SHARE_OFFLINE =
  'The machine that shares this task is offline. This page opens it again as soon as it is back.';

export const SHARE_UNREACHABLE = 'Couldn’t reach app.shinsa.dev. This page tries again on its own.';

const SHARE_RETRY_MS = [1_000, 2_000, 5_000, 10_000];

export interface ShareSocket {
  binaryType: string;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    type: 'open' | 'message' | 'close',
    listener: (event: { data?: unknown }) => void
  ) => void;
}

export interface ShareStreamHandlers {
  onSource: (source: SharedSource) => void;
  onError: (error: Error) => void;
}

export interface ShareStreamOptions {
  fetch?: typeof fetch;
  createSocket?: (url: string) => ShareSocket;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  wait?: (ms: number, run: () => void) => () => void;
}

interface Received {
  version: string;
  type: ShareFileType;
  chunks: Bytes[];
}

interface Stored {
  version: string;
  url: string;
}

function waitFor(ms: number, run: () => void) {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

async function requestConnect(link: ShareLink, read: typeof fetch) {
  let response: Response;
  try {
    response = await read(resolveShareConnectPath(link.instanceId), { method: 'POST' });
  } catch {
    throw new Error(SHARE_UNREACHABLE);
  }
  if (response.status === 404) throw new ShareGoneError();
  if (!response.ok) throw new Error(SHARE_UNREACHABLE);
  return (await response.json()) as ShareConnectResponse;
}

function toBytes(data: unknown): Bytes | null {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : null;
}

export function openShareStream(
  link: ShareLink,
  handlers: ShareStreamHandlers,
  options: ShareStreamOptions = {}
) {
  const read = options.fetch ?? fetch;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url) as ShareSocket);
  const createUrl = options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl = options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const wait = options.wait ?? waitFor;
  const stored = new Map<string, Stored>();
  let view: ShareLiveView | null = null;
  let socket: ShareSocket | null = null;
  let cancelWait: (() => void) | null = null;
  let attempt = 0;
  let stopped = false;

  function emit() {
    if (!view) return;
    const current = view;
    handlers.onSource({
      shared: current.shared,
      updatedAt: current.updatedAt,
      resolveFileUrl: (id) => {
        const file = stored.get(id);
        return file && file.version === current.files[id]?.version ? file.url : null;
      },
    });
  }

  function fail(error: Error) {
    socket?.close();
    socket = null;
    if (stopped) return;
    handlers.onError(error);
    if (error instanceof ShareGoneError) {
      stopped = true;
      return;
    }
    const delay = SHARE_RETRY_MS[Math.min(attempt, SHARE_RETRY_MS.length - 1)] ?? 0;
    attempt += 1;
    cancelWait = wait(delay, () => void connect());
  }

  function store(id: string, file: Received) {
    const previous = stored.get(id);
    if (previous) revokeUrl(previous.url);
    stored.set(id, {
      version: file.version,
      url: createUrl(new Blob([concatBytes(...file.chunks)], { type: file.type })),
    });
  }

  function createReader(open: (frame: Bytes) => Promise<Bytes>) {
    const receiving = new Map<string, Received>();
    return async (frame: Bytes) => {
      const message: ShareMessage | null = parseShareMessage(decodeText(await open(frame)));
      if (!message) throw new Error('The machine sent something this page cannot read. Reload the page.');
      switch (message.t) {
        case 'view':
          view = JSON.parse(message.data) as ShareLiveView;
          attempt = 0;
          emit();
          return;
        case 'file':
          receiving.set(message.id, { version: message.version, type: message.type, chunks: [] });
          return;
        case 'body': {
          const bytes = parseBodyChunk(message.chunk);
          if (bytes) receiving.get(message.id)?.chunks.push(bytes);
          return;
        }
        case 'end': {
          const file = receiving.get(message.id);
          receiving.delete(message.id);
          if (!file) return;
          store(message.id, file);
          emit();
          return;
        }
        case 'closed':
          throw new ShareGoneError(message.reason);
      }
    };
  }

  async function connect() {
    let answer: ShareConnectResponse;
    try {
      answer = await requestConnect(link, read);
    } catch (error) {
      fail(error as Error);
      return;
    }
    if (stopped) return;
    if (!answer.online) {
      fail(new Error(SHARE_OFFLINE));
      return;
    }
    const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const hello = await createShareHello(link.shareId, link.key, ephemeral.publicKey);
    const opened = createSocket(resolveShareChannelUrl(answer.url, link.shareId));
    socket = opened;
    opened.binaryType = 'arraybuffer';
    let readFrame: ((frame: Bytes) => Promise<void>) | null = null;
    let queue: Promise<void> = Promise.resolve();
    const readWelcome = async (text: string) => {
      const welcome = parseShareWelcome(text);
      if (welcome?.type === 'refused') throw new ShareGoneError(welcome.reason);
      if (welcome?.type !== 'welcome' || readFrame) throw new Error(SHARE_OFFLINE);
      const keys = {
        share: link.shareId,
        clientEphemeral: hello.ephemeral,
        serverEphemeral: welcome.ephemeral,
      };
      if (!(await verifyShareWelcome(link.key, keys, welcome.proof))) throw new ShareGoneError();
      const key = await deriveShareSessionKey(link.key, keys, ephemeral.privateKey, welcome.ephemeral);
      readFrame = createReader(createFrameOpener(key));
    };
    const readMessage = async (data: unknown) => {
      if (typeof data === 'string') {
        await readWelcome(data);
        return;
      }
      const frame = toBytes(data);
      if (!(frame && readFrame)) throw new Error(SHARE_OFFLINE);
      await readFrame(frame);
    };
    opened.addEventListener('open', () => opened.send(JSON.stringify(hello)));
    opened.addEventListener('close', () => {
      if (socket === opened) fail(new Error(SHARE_OFFLINE));
    });
    opened.addEventListener('message', (event) => {
      queue = queue.then(async () => {
        if (socket !== opened) return;
        try {
          await readMessage(event.data);
        } catch (error) {
          fail(error as Error);
        }
      });
    });
  }

  void connect();
  return () => {
    stopped = true;
    cancelWait?.();
    socket?.close();
    socket = null;
    for (const file of stored.values()) revokeUrl(file.url);
    stored.clear();
  };
}
