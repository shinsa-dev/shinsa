import { type GuestActor, parseTeamViewTarget, TEAM_VIEW_PATH } from '@shinsa/core';
import { serializeEngineFailure } from '@shinsa/core/engine-api/errors';
import {
  ENGINE_BODY_LIMIT_BYTES,
  RequestForbidden,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
} from '@shinsa/core/engine-api/schema';
import type { ServerWebSocket } from 'bun';
import { Context, Effect, Exit, Layer, Predicate, Scope } from 'effect';
import { createServerInstance } from '../instance/index.ts';
import type { UpgradeRefusal } from '../remote/gate/schema.ts';
import { TunnelGate } from '../remote/gate/service.ts';
import type { ChannelPeer, RemoteChannel } from '../remote/index.ts';
import type { PreviewRelay, PreviewUpgrade } from '../remote/previews.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { ATTACHMENT_REQUEST_LIMIT_BYTES } from '../store/index.ts';
import { createTerminalSockets, readTerminalSocketId, type TerminalSocketData } from '../terminals/index.ts';
import { makeEngineHandler } from './app.ts';
import { resolveAllowedHosts, resolveRefusal, resolveUpgradeRefusal } from './guard.ts';
import { FIXED_FAILURES, type HttpContext, PORT_TAKEN, PortInUse, RequestSource } from './schema.ts';
import { HttpServices } from './services/service.ts';
import { createSocketHub, type SocketData } from './socket.ts';

export type { HttpContext } from './schema.ts';

const SOCKET_BACKPRESSURE_LIMIT_BYTES = 128 * 1024 * 1024;

interface RemoteSocketData {
  kind: 'remote';
  channel: RemoteChannel | null;
  userId: string;
}

interface LiveChannel {
  receive: (raw: string | Buffer) => unknown;
  close: () => void;
}

interface LiveSocketData {
  kind: 'live';
  open: (peer: ChannelPeer) => LiveChannel;
  channel: LiveChannel | null;
}

interface PreviewSocketData {
  kind: 'preview';
  upgrade: PreviewUpgrade;
  relay: PreviewRelay | null;
}

type ServerSocketData =
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
}

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

export function resolveServerUrl(hostname: string, port: number) {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}

function respondRefusal(failure: { readonly code: string; readonly status: number }, message: string) {
  return Response.json(serializeEngineFailure({ code: failure.code, message }), { status: failure.status });
}

function respondNotFound() {
  return respondRefusal(RouteNotFound, ROUTE_NOT_FOUND_MESSAGE);
}

function respondUpgradeRefusal(refusal: UpgradeRefusal) {
  return respondRefusal(FIXED_FAILURES[refusal._tag], refusal.message);
}

type Hub = ReturnType<typeof createSocketHub>;

type TerminalSockets = ReturnType<typeof createTerminalSockets>;

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
    },
  };
}

const serveHttp = Effect.fn('serveHttp')(function* (context: HttpContext) {
  const { config, terminals, remote, shares, teams, previews } = context;
  const allowedHosts = resolveAllowedHosts(config.allowedHosts);
  const hub = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createSocketHub(
        context.engine,
        context.transcripts,
        context.accounts,
        context.classify ?? null,
        terminals,
        remote,
        context.teamFeeds,
        (context.instance ?? createServerInstance()).version,
        context.resources
      )
    ),
    (opened) => Effect.sync(() => opened.stop())
  );
  const web = yield* Effect.acquireRelease(
    Effect.sync(() => makeEngineHandler(context)),
    (handler) => Effect.promise(() => handler.dispose())
  );
  const handle = web.handler as (request: Request, services: Context.Context<never>) => Promise<Response>;
  const terminalSockets = terminals ? createTerminalSockets(terminals) : null;
  const gate = yield* Effect.gen(function* () {
    return yield* TunnelGate;
  }).pipe(Effect.provide(TunnelGate.layer.pipe(Layer.provide(HttpServices.layer(context)))));

  function respondInsideChannel(request: Request, guest: GuestActor | null, userId: string) {
    return handle(request, Context.make(RequestSource, { via: 'channel', guest, userId }));
  }

  function upgrade(request: Request, bunServer: Bun.Server<ServerSocketData>, data: ServerSocketData) {
    const upgradeRefusal = resolveUpgradeRefusal(request);
    if (upgradeRefusal) return respondRefusal(RequestForbidden, upgradeRefusal);
    return upgradeAdmitted(request, bunServer, data);
  }

  function upgradeAdmitted(
    request: Request,
    bunServer: Bun.Server<ServerSocketData>,
    data: ServerSocketData,
    headers?: Record<string, string>
  ) {
    if (bunServer.upgrade(request, { data, ...(headers ? { headers } : {}) })) return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  const remoteSockets: RemoteSocketHandlers | null = remote
    ? {
        open: (socket) => {
          socket.data.channel = remote.openChannel(
            {
              send: (data) => socket.send(data),
              close: (code, reason) => socket.close(code, reason),
            },
            { hub, respond: respondInsideChannel },
            socket.data.userId
          );
        },
        close: (socket) => {
          if (socket.data.channel) remote.closeChannel(socket.data.channel);
        },
        message: (socket, raw) => {
          void socket.data.channel?.receive(raw);
        },
      }
    : null;

  const previewSockets: PreviewSocketHandlers | null = previews
    ? {
        open: (socket) => {
          socket.data.relay = previews.openSocket(
            {
              send: (data) => socket.send(data),
              close: (code, reason) => socket.close(code, reason),
            },
            socket.data.upgrade
          );
        },
        close: (socket) => {
          socket.data.relay?.close();
        },
        message: (socket, raw) => {
          socket.data.relay?.send(typeof raw === 'string' ? raw : new Uint8Array(raw));
        },
      }
    : null;

  const respondPreview = Effect.fn('serveHttp.respondPreview')(function* (
    request: Request,
    url: URL,
    bunServer: Bun.Server<ServerSocketData>
  ) {
    if (!previews) return respondNotFound();
    const answer = yield* Effect.promise(() => previews.answer(request, url));
    if (answer.kind === 'response') return answer.response;
    const [protocol] = answer.upgrade.protocols;
    const headers = protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined;
    const data: PreviewSocketData = { kind: 'preview', upgrade: answer.upgrade, relay: null };
    return upgradeAdmitted(request, bunServer, data, headers);
  });

  function openShareChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, shareId: string) {
    if (!shares) return respondNotFound();
    const open = (peer: ChannelPeer) => {
      const channel = shares.openChannel(peer, shareId);
      return {
        receive: (raw: string | Buffer) => channel.receive(raw),
        close: () => shares.closeChannel(channel),
      };
    };
    return upgradeAdmitted(request, bunServer, { kind: 'live', open, channel: null });
  }

  function openTeamChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, userId: string) {
    if (!teams) return respondNotFound();
    const open = (peer: ChannelPeer) => {
      const channel = teams.openChannel(peer, userId);
      return {
        receive: (raw: string | Buffer) => channel.receive(raw),
        close: () => teams.closeChannel(channel),
      };
    };
    return upgradeAdmitted(request, bunServer, { kind: 'live', open, channel: null });
  }

  function openRemoteChannel(request: Request, bunServer: Bun.Server<ServerSocketData>, userId: string) {
    return upgradeAdmitted(request, bunServer, { kind: 'remote', channel: null, userId });
  }

  function respondTeamView(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    const { teamFeeds } = context;
    const target = parseTeamViewTarget(url);
    if (!(teamFeeds && target)) return respondNotFound();
    const open = (peer: ChannelPeer) => {
      const relay = teamFeeds.openRelay(peer, target);
      return {
        receive: () => {
          relay.close();
          peer.close(1008, 'A team view only listens.');
        },
        close: () => relay.close(),
      };
    };
    return upgrade(request, bunServer, { kind: 'live', open, channel: null });
  }

  const respondTunnelSocket = Effect.fn('serveHttp.respondTunnelSocket')(function* (
    request: Request,
    url: URL,
    bunServer: Bun.Server<ServerSocketData>
  ) {
    const admitted = yield* gate.admitUpgrade(request, url).pipe(Effect.result);
    if (admitted._tag === 'Failure') return respondUpgradeRefusal(admitted.failure);
    const admission = admitted.success;
    if (admission.route === 'share') return openShareChannel(request, bunServer, admission.shareId);
    if (admission.route === 'team') return openTeamChannel(request, bunServer, admission.userId);
    if (admission.route === 'channel') return openRemoteChannel(request, bunServer, admission.userId);
    if (admission.route === 'preview') return yield* respondPreview(request, url, bunServer);
    return yield* Effect.promise(() => handle(request, Context.empty()));
  });

  const run = Effect.runPromiseWith(yield* Effect.context<never>());

  function respondLocalSocket(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    const isPage = url.pathname === '/ws';
    const isTeamView = url.pathname === TEAM_VIEW_PATH;
    const terminalId = terminalSockets ? readTerminalSocketId(url.pathname) : null;
    if (!(isPage || isTeamView || terminalId)) return null;
    const refusal = resolveRefusal(request, allowedHosts);
    if (refusal) return respondRefusal(RequestForbidden, refusal);
    if (isTeamView) return respondTeamView(request, url, bunServer);
    if (terminalId) return upgrade(request, bunServer, { kind: 'terminal', terminalId, viewer: null });
    return upgrade(request, bunServer, {
      kind: 'hub',
      transcripts: new Map(),
      surface: null,
      origin: 'local',
      guest: null,
    });
  }

  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve<ServerSocketData>({
        port: config.port,
        hostname: config.hostname,
        maxRequestBodySize: ATTACHMENT_REQUEST_LIMIT_BYTES,
        fetch(request, bunServer) {
          const url = new URL(request.url);
          if (gate.isTunnel(request)) return run(respondTunnelSocket(request, url, bunServer));
          return respondLocalSocket(request, url, bunServer) ?? handle(request, Context.empty());
        },
        websocket: {
          ...createSocketHandlers(hub, terminalSockets, remoteSockets, previewSockets),
          maxPayloadLength: ENGINE_BODY_LIMIT_BYTES,
          backpressureLimit: SOCKET_BACKPRESSURE_LIMIT_BYTES,
        },
      })
    ).pipe(
      Effect.catchDefect((defect) =>
        Predicate.hasProperty(defect, 'code') && defect.code === PORT_TAKEN
          ? Effect.fail(
              new PortInUse({
                message: `Failed to start server. Is port ${config.port} in use? Quit the program on it, or set another \`port\` in ${config.configPath}.`,
              })
            )
          : Effect.die(defect)
      )
    ),
    (listening) => Effect.promise(() => listening.stop(true))
  );
  const url = resolveServerUrl(config.hostname, server.port ?? config.port);
  yield* Effect.logInfo('[Server] Listening').pipe(Effect.annotateLogs({ url }));
  return { server, url };
});

export function startServer(context: HttpContext) {
  const scope = Scope.makeUnsafe();
  const stop = () => edgeRuntime.runPromise(Scope.close(scope, Exit.void));
  const served = edgeRuntime.runSync(
    serveHttp(context).pipe(
      Scope.provide(scope),
      Effect.onError(() => Effect.forkDetach(Scope.close(scope, Exit.void)))
    )
  );
  return { ...served, stop };
}
