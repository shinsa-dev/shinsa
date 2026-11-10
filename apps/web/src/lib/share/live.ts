import {
  type Bytes,
  concatBytes,
  parseBodyChunk,
  type ShareFileType,
  type ShareLink,
  type ShareLiveView,
} from '@shinsa/core';
import { Effect, Option, Schema } from 'effect';
import { forkApp } from '@/lib/runtime/app.ts';
import { type RequestFetch, sendThrough } from '@/lib/runtime/fetch.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import { provideTransport } from '@/lib/runtime/socket/transport.ts';
import { ShareGoneError } from '@/lib/share/sources.ts';
import type { SharedSource } from '@/lib/share/view.ts';
import { type ShareContent, type ShareSession, ShareLiveViewText } from './share-socket/schema.ts';
import { ShareSocket } from './share-socket/service.ts';

export interface ShareStreamHandlers {
  onSource: (source: SharedSource) => void;
  onError: (error: Error) => void;
}

export interface ShareReceiverOptions {
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}

export interface ShareStreamOptions extends ShareReceiverOptions {
  fetch?: RequestFetch;
  transport?: SocketTransport;
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

const decodeView = Schema.decodeUnknownOption(ShareLiveViewText);

export function createShareReceiver(
  onSource: (source: SharedSource) => void,
  options: ShareReceiverOptions = {}
) {
  const createUrl = options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl = options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const stored = new Map<string, Stored>();
  let receiving = new Map<string, Received>();
  let view: ShareLiveView | null = null;

  function emit() {
    if (!view) return;
    const current = view;
    onSource({
      shared: current.shared,
      updatedAt: current.updatedAt,
      resolveFileUrl: (id) => {
        const file = stored.get(id);
        return file && file.version === current.files[id]?.version ? file.url : null;
      },
    });
  }

  function store(id: string, file: Received) {
    const previous = stored.get(id);
    if (previous) revokeUrl(previous.url);
    stored.set(id, {
      version: file.version,
      url: createUrl(new Blob([concatBytes(...file.chunks)], { type: file.type })),
    });
  }

  return {
    restart() {
      receiving = new Map();
    },
    receive(message: ShareContent) {
      switch (message.t) {
        case 'view': {
          const decoded = decodeView(message.data);
          if (Option.isNone(decoded)) return false;
          view = decoded.value;
          emit();
          break;
        }
        case 'file':
          receiving.set(message.id, { version: message.version, type: message.type, chunks: [] });
          break;
        case 'body': {
          const bytes = Option.getOrNull(parseBodyChunk(message.chunk));
          if (bytes) receiving.get(message.id)?.chunks.push(bytes);
          break;
        }
        case 'end': {
          const file = receiving.get(message.id);
          receiving.delete(message.id);
          if (!file) break;
          store(message.id, file);
          emit();
          break;
        }
      }
      return true;
    },
    stop() {
      for (const file of stored.values()) revokeUrl(file.url);
      stored.clear();
    },
  };
}

export function openShareStream(
  link: ShareLink,
  handlers: ShareStreamHandlers,
  options: ShareStreamOptions = {}
) {
  const receiver = createShareReceiver(handlers.onSource, options);
  const session: ShareSession = {
    welcomed: () => receiver.restart(),
    received: (message) => receiver.receive(message),
    dropped: (drop) =>
      handlers.onError(drop.final ? new ShareGoneError(drop.reason) : new Error(drop.reason)),
  };
  const fetch = options.fetch;
  const stream = Effect.gen(function* () {
    const socket = yield* ShareSocket;
    yield* socket.connect(link, session);
  }).pipe(Effect.provide(ShareSocket.layer), provideTransport(options.transport));
  const fiber = forkApp(fetch ? sendThrough(fetch)(stream) : stream);
  return () => {
    fiber.interruptUnsafe();
    receiver.stop();
  };
}
