import { serializeEngineFailure } from '@shinsa/core/engine-api/errors';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import type { ServerWebSocket } from 'bun';
import { Effect } from 'effect';
import type { ChannelPeer, RemoteChannelHandle } from '../../remote/channel/schema.ts';
import type { UpgradeRefusal } from '../../remote/gate/schema.ts';
import type { ChannelParts, RemoteHandle } from '../../remote/machine/schema.ts';
import type { PreviewRelay, PreviewUpgrade } from '../../remote/previews/schema.ts';
import type { createTerminalSockets, TerminalSocketData } from '../../terminals/index.ts';
import { FIXED_FAILURES } from '../schema.ts';
import type { makeSocketHub, SocketData } from '../socket.ts';

export const SOCKET_BACKPRESSURE_LIMIT_BYTES = 128 * 1024 * 1024;

export interface RemoteSocketData {
  kind: 'remote';
  channel: RemoteChannelHandle | null;
  userId: string;
}

interface LiveChannel {
  receive: (raw: string | Buffer) => unknown;
  close: () => void;
}

export interface LiveSocketData {
  kind: 'live';
  open: (peer: ChannelPeer) => LiveChannel;
  channel: LiveChannel | null;
}

export interface PreviewSocketData {
  kind: 'preview';
  upgrade: PreviewUpgrade;
  relay: PreviewRelay | null;
}

export type ServerSocketData =
  | SocketData
  | TerminalSocketData
  | RemoteSocketData
  | LiveSocketData
  | PreviewSocketData;

type ServerSocket = ServerWebSocket<ServerSocketData>;

function isTerminalSocket(socket: ServerSocket): socket is ServerWebSocket<TerminalSocketData> {
  return socket.data.kind === 'terminal';
}

function isRemoteSocket(socket: ServerSocket): socket is ServerWebSocket<RemoteSocketData> {
  return socket.data.kind === 'remote';
}

function isLiveSocket(socket: ServerSocket): socket is ServerWebSocket<LiveSocketData> {
  return socket.data.kind === 'live';
}

function isPreviewSocket(socket: ServerSocket): socket is ServerWebSocket<PreviewSocketData> {
  return socket.data.kind === 'preview';
}

export interface RemoteSocketHandlers {
  open: (socket: ServerWebSocket<RemoteSocketData>) => void;
  close: (socket: ServerWebSocket<RemoteSocketData>) => void;
  message: (socket: ServerWebSocket<RemoteSocketData>, raw: string | Buffer) => void;
  drain: (socket: ServerWebSocket<RemoteSocketData>) => void;
}

export const makeRemoteSockets = Effect.fn('RemoteSockets.make')(function* (
  remote: Pick<RemoteHandle, 'openChannel' | 'closeChannel'>,
  parts: ChannelParts
) {
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const handlers: RemoteSocketHandlers = {
    open: (socket) => {
      socket.data.channel = runSync(
        remote.openChannel(
          {
            send: (data) => socket.send(data),
            close: (code, reason) => socket.close(code, reason),
            buffered: () => socket.getBufferedAmount(),
          },
          parts,
          socket.data.userId
        )
      );
    },
    close: (socket) => {
      if (socket.data.channel) runFork(remote.closeChannel(socket.data.channel));
    },
    message: (socket, raw) => {
      if (socket.data.channel) runFork(socket.data.channel.receive(raw));
    },
    drain: (socket) => {
      if (socket.data.channel) runFork(socket.data.channel.drain);
    },
  };
  return handlers;
});

const LIVE_SOCKETS = {
  open: (socket: ServerWebSocket<LiveSocketData>) => {
    socket.data.channel = socket.data.open({
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    });
  },
  close: (socket: ServerWebSocket<LiveSocketData>) => {
    socket.data.channel?.close();
  },
  message: (socket: ServerWebSocket<LiveSocketData>, raw: string | Buffer) => {
    void socket.data.channel?.receive(raw);
  },
};

export interface PreviewSocketHandlers {
  open: (socket: ServerWebSocket<PreviewSocketData>) => void;
  close: (socket: ServerWebSocket<PreviewSocketData>) => void;
  message: (socket: ServerWebSocket<PreviewSocketData>, raw: string | Buffer) => void;
}

type Hub = Effect.Success<ReturnType<typeof makeSocketHub>>;

type TerminalSockets = Effect.Success<ReturnType<typeof createTerminalSockets>>;

export function createSocketHandlers(
  hub: Pick<Hub, 'open' | 'close' | 'message'>,
  terminals: TerminalSockets | null,
  remote: RemoteSocketHandlers | null = null,
  previews: PreviewSocketHandlers | null = null
) {
  return {
    open: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.open(socket);
      else if (isRemoteSocket(socket)) remote?.open(socket);
      else if (isLiveSocket(socket)) LIVE_SOCKETS.open(socket);
      else if (isPreviewSocket(socket)) previews?.open(socket);
      else hub.open(socket as ServerWebSocket<SocketData>);
    },
    close: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.close(socket);
      else if (isRemoteSocket(socket)) remote?.close(socket);
      else if (isLiveSocket(socket)) LIVE_SOCKETS.close(socket);
      else if (isPreviewSocket(socket)) previews?.close(socket);
      else hub.close(socket as ServerWebSocket<SocketData>);
    },
    message: (socket: ServerSocket, raw: string | Buffer) => {
      if (isTerminalSocket(socket)) terminals?.message(socket, raw);
      else if (isRemoteSocket(socket)) remote?.message(socket, raw);
      else if (isLiveSocket(socket)) LIVE_SOCKETS.message(socket, raw);
      else if (isPreviewSocket(socket)) previews?.message(socket, raw);
      else hub.message(socket as ServerWebSocket<SocketData>, raw);
    },
    drain: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.drain(socket);
      else if (isRemoteSocket(socket)) remote?.drain(socket);
    },
  };
}

export function respondRefusal(failure: { readonly code: string; readonly status: number }, message: string) {
  return Response.json(serializeEngineFailure({ code: failure.code, message }), { status: failure.status });
}

export function respondNotFound() {
  return respondRefusal(RouteNotFound, ROUTE_NOT_FOUND_MESSAGE);
}

export function respondUpgradeRefusal(refusal: UpgradeRefusal) {
  return respondRefusal(FIXED_FAILURES[refusal._tag], refusal.message);
}
