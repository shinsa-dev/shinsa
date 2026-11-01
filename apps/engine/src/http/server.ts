import {
  type GuestActor,
  LOCAL_ONLY_CODE,
  LOCAL_ONLY_MESSAGE,
  parseTeamViewTarget,
  REMOTE_CONNECT_PARAM,
  SCOPE_MESSAGES,
  SCOPE_REFUSAL_CODE,
  SHARE_CHANNEL_PARAM,
  TEAM_VIEW_PATH,
} from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { respondSignInPage } from '../extensions/routes.ts';
import { createServerInstance, INSPECT_MESSAGE, INSPECT_READ_ONLY } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { isGuestRoute } from '../remote/guest-routes.ts';
import {
  type ChannelPeer,
  isTunnelRequest,
  markRemoteRequest,
  type RemoteChannel,
  resolveChannelOriginRefusal,
  resolveLocalOnlyRoute,
  resolveTunnelRoute,
} from '../remote/index.ts';
import type { PreviewRelay, PreviewUpgrade } from '../remote/previews.ts';
import type { ResourceMonitor } from '../resources/index.ts';
import { ATTACHMENT_REQUEST_LIMIT_BYTES } from '../store/index.ts';
import {
  createTerminalRoutes,
  createTerminalSockets,
  readTerminalSocketId,
  type ServiceRefiner,
  type TerminalSocketData,
  type Terminals,
} from '../terminals/index.ts';
import { MAX_BODY_BYTES } from './body.ts';
import {
  resolveAllowedHosts,
  resolveBodyRefusal,
  resolveBodySizeRefusal,
  resolveHostRefusal,
  resolveRefusal,
  resolveUpgradeRefusal,
} from './guard.ts';
import { type ApiContext, createApiRoutes, respondError, respondFailure } from './routes.ts';
import { createSocketHub, type SocketData } from './socket.ts';
import { serveStatic } from './static.ts';

const ATTACHMENT_UPLOAD_PATH = '/api/attachments';

const SOCKET_BACKPRESSURE_LIMIT_BYTES = 128 * 1024 * 1024;

export interface HttpContext extends ApiContext {
  transcripts: Transcripts;
  terminals?: Terminals;
  refiner?: ServiceRefiner;
  resources?: Pick<ResourceMonitor, 'subscribe' | 'snapshot'>;
}

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

function respondReadOnly() {
  return respondError(INSPECT_READ_ONLY, INSPECT_MESSAGE, 403);
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

function isPortTaken(error: unknown) {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

function listenOnPort<T>(config: Pick<HttpContext['config'], 'port' | 'configPath'>, listen: () => T) {
  try {
    return listen();
  } catch (error) {
    if (!isPortTaken(error)) throw error;
    throw new Error(
      `Failed to start server. Is port ${config.port} in use? Quit the program on it, or set another \`port\` in ${config.configPath}.`
    );
  }
}

export function startServer(context: HttpContext) {
  const { config } = context;
  const allowedHosts = resolveAllowedHosts(config.allowedHosts);
  const { terminals } = context;
  const handleApi = createApiRoutes(
    context,
    terminals ? createTerminalRoutes(context.engine, terminals, context.refiner ?? null) : []
  );
  const hub = createSocketHub(
    context.engine,
    context.transcripts,
    context.accounts,
    context.classify ?? null,
    terminals,
    context.remote,
    context.teamFeeds,
    (context.instance ?? createServerInstance()).version,
    context.resources
  );
  const terminalSockets = terminals ? createTerminalSockets(terminals) : null;
  const { remote } = context;

  function upgrade(request: Request, bunServer: Bun.Server<ServerSocketData>, data: ServerSocketData) {
    const upgradeRefusal = resolveUpgradeRefusal(request);
    if (upgradeRefusal) return respondError('forbidden', upgradeRefusal, 403);
    if (bunServer.upgrade(request, { data })) return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  async function respondApi(request: Request, url: URL) {
    if (config.inspect && request.method !== 'GET') return respondReadOnly();
    const refusal = resolveBodyRefusal(request);
    if (refusal) return respondError('content_type_invalid', refusal, 415);
    const limit = url.pathname === ATTACHMENT_UPLOAD_PATH ? ATTACHMENT_REQUEST_LIMIT_BYTES : MAX_BODY_BYTES;
    const sizeRefusal = resolveBodySizeRefusal(request, limit);
    if (sizeRefusal) return respondError('body_too_large', sizeRefusal, 413);
    try {
      return await handleApi(request, url);
    } catch (error) {
      log.warn('[Server] Request failed', { path: url.pathname, error: describeError(error) });
      return respondFailure(error);
    }
  }

  function respondInsideChannel(request: Request, guest: GuestActor | null) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/'))
      return Promise.resolve(respondError('not_found', 'No such endpoint.', 404));
    if (
      guest &&
      !isGuestRoute(context.engine.state, guest.taskId, request.method, url.pathname, context.transcripts)
    )
      return Promise.resolve(respondError(SCOPE_REFUSAL_CODE, SCOPE_MESSAGES.task, 403));
    if (resolveLocalOnlyRoute(request.method, url.pathname))
      return Promise.resolve(respondError(LOCAL_ONLY_CODE, LOCAL_ONLY_MESSAGE, 403));
    return respondApi(markRemoteRequest(request), url);
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

  const { shares, teams } = context;

  const { previews } = context;
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

  async function respondPreview(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    if (!previews) return respondError('not_found', 'No such endpoint.', 404);
    const answer = await previews.answer(request, url);
    if (answer.kind === 'response') return answer.response;
    const [protocol] = answer.upgrade.protocols;
    const headers = protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined;
    const data: PreviewSocketData = { kind: 'preview', upgrade: answer.upgrade, relay: null };
    if (bunServer.upgrade(request, { data, ...(headers ? { headers } : {}) })) return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  function respondShareChannel(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    if (!(remote && shares)) return respondError('not_found', 'No such endpoint.', 404);
    const originRefusal = resolveChannelOriginRefusal(request, remote.appOrigin);
    if (originRefusal) return respondError('forbidden', originRefusal, 403);
    const shareId = url.searchParams.get(SHARE_CHANNEL_PARAM) ?? '';
    if (!shares.acceptsShare(shareId)) return respondError('not_found', 'No such endpoint.', 404);
    const open = (peer: ChannelPeer) => {
      const channel = shares.openChannel(peer, shareId);
      return {
        receive: (raw: string | Buffer) => channel.receive(raw),
        close: () => shares.closeChannel(channel),
      };
    };
    const data: LiveSocketData = { kind: 'live', open, channel: null };
    if (bunServer.upgrade(request, { data })) return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  async function respondTeamChannel(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    if (!(remote && teams?.acceptsViewer())) return respondError('not_found', 'No such endpoint.', 404);
    const originRefusal = resolveChannelOriginRefusal(request, remote.appOrigin);
    if (originRefusal) return respondError('forbidden', originRefusal, 403);
    const claim = await remote.verifyConnect(url.searchParams.get(REMOTE_CONNECT_PARAM));
    if (!claim) return respondError('unauthorized', 'The connect token is missing, wrong or expired.', 401);
    const open = (peer: ChannelPeer) => {
      const channel = teams.openChannel(peer, claim.userId);
      return {
        receive: (raw: string | Buffer) => channel.receive(raw),
        close: () => teams.closeChannel(channel),
      };
    };
    const data: LiveSocketData = { kind: 'live', open, channel: null };
    if (bunServer.upgrade(request, { data })) return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  function respondTeamView(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    const { teamFeeds } = context;
    const target = parseTeamViewTarget(url);
    if (!(teamFeeds && target)) return respondError('not_found', 'No such endpoint.', 404);
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

  function respondTunnel(request: Request, url: URL, bunServer: Bun.Server<ServerSocketData>) {
    const route = remote?.isEnabled ? resolveTunnelRoute(request, url) : null;
    if (route === 'health') return Response.json({ ok: true });
    if (route === 'hook' && context.schedules?.isWebhook(url.pathname)) {
      if (config.inspect) return respondReadOnly();
      return context.schedules.handleWebhook(request, url);
    }
    if (route === 'share') return respondShareChannel(request, url, bunServer);
    if (route === 'team') return respondTeamChannel(request, url, bunServer);
    if (route === 'preview') return respondPreview(request, url, bunServer);
    if (route === 'slack' && context.slack) {
      if (config.inspect) return respondReadOnly();
      return context.slack.handleTunnel(request, url);
    }
    if (route !== 'channel' || !remote) return respondError('not_found', 'No such endpoint.', 404);
    return respondRemoteChannel(request, url, bunServer, remote);
  }

  async function respondRemoteChannel(
    request: Request,
    url: URL,
    bunServer: Bun.Server<ServerSocketData>,
    channelRemote: NonNullable<typeof remote>
  ) {
    const originRefusal = resolveChannelOriginRefusal(request, channelRemote.appOrigin);
    if (originRefusal) return respondError('forbidden', originRefusal, 403);
    const claim = await channelRemote.verifyConnect(url.searchParams.get(REMOTE_CONNECT_PARAM));
    if (!claim) return respondError('unauthorized', 'The connect token is missing, wrong or expired.', 401);
    if (bunServer.upgrade(request, { data: { kind: 'remote', channel: null, userId: claim.userId } }))
      return undefined;
    return new Response('Upgrade failed', { status: 400 });
  }

  function respondOutside(request: Request, url: URL) {
    const { schedules, extensions } = context;
    if (schedules?.isWebhook(url.pathname)) {
      if (config.inspect) return respondReadOnly();
      return schedules.handleWebhook(request, url);
    }
    if (!extensions?.isCallback(url.pathname) || request.method !== 'GET') return null;
    if (config.inspect) return respondReadOnly();
    const hostRefusal = resolveHostRefusal(request, allowedHosts);
    if (hostRefusal) return respondError('forbidden', hostRefusal, 403);
    return respondSignInPage(extensions, request);
  }

  const server = listenOnPort(config, () =>
    Bun.serve<ServerSocketData>({
      port: config.port,
      hostname: config.hostname,
      maxRequestBodySize: ATTACHMENT_REQUEST_LIMIT_BYTES,
      fetch(request, bunServer) {
        const url = new URL(request.url);
        if (remote && isTunnelRequest(request, remote.tunnelHost))
          return respondTunnel(request, url, bunServer);
        const outside = respondOutside(request, url);
        if (outside) return outside;
        const refusal = resolveRefusal(request, allowedHosts);
        if (refusal) return respondError('forbidden', refusal, 403);
        if (url.pathname === '/ws')
          return upgrade(request, bunServer, {
            kind: 'hub',
            transcripts: new Map(),
            surface: null,
            origin: 'local',
            guest: null,
          });
        if (url.pathname === TEAM_VIEW_PATH) return respondTeamView(request, url, bunServer);
        const terminalId = terminalSockets ? readTerminalSocketId(url.pathname) : null;
        if (terminalId) return upgrade(request, bunServer, { kind: 'terminal', terminalId, viewer: null });
        if (url.pathname.startsWith('/api/')) return respondApi(request, url);
        return serveStatic(config.webDir, url.pathname);
      },
      websocket: {
        ...createSocketHandlers(hub, terminalSockets, remoteSockets, previewSockets),
        maxPayloadLength: MAX_BODY_BYTES,
        backpressureLimit: SOCKET_BACKPRESSURE_LIMIT_BYTES,
      },
    })
  );
  const address = resolveServerUrl(config.hostname, server.port ?? config.port);
  log.info('[Server] Listening', { url: address });
  return {
    server,
    url: address,
    stop: async () => {
      hub.stop();
      await server.stop(true);
    },
  };
}
