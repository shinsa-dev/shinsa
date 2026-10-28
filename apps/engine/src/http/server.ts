import type { ServerWebSocket } from 'bun';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { respondSignInPage } from '../extensions/routes.ts';
import { INSPECT_MESSAGE, INSPECT_READ_ONLY } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { ATTACHMENT_REQUEST_LIMIT_BYTES } from '../store/index.ts';
import {
  createTerminalRoutes,
  createTerminalSockets,
  readTerminalSocketId,
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

export interface HttpContext extends ApiContext {
  transcripts: Transcripts;
  terminals?: Terminals;
}

type ServerSocketData = SocketData | TerminalSocketData;

type ServerSocket = ServerWebSocket<ServerSocketData>;

function isTerminalSocket(socket: ServerSocket): socket is ServerWebSocket<TerminalSocketData> {
  return socket.data.kind === 'terminal';
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
  terminals: TerminalSockets | null
) {
  return {
    open: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.open(socket);
      else hub.open(socket as ServerWebSocket<SocketData>);
    },
    close: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.close(socket);
      else hub.close(socket as ServerWebSocket<SocketData>);
    },
    message: (socket: ServerSocket, raw: string | Buffer) => {
      if (isTerminalSocket(socket)) terminals?.message(socket, raw);
      else hub.message(socket as ServerWebSocket<SocketData>, raw);
    },
    drain: (socket: ServerSocket) => {
      if (isTerminalSocket(socket)) terminals?.drain(socket);
    },
  };
}

export function startServer(context: HttpContext) {
  const { config } = context;
  const allowedHosts = resolveAllowedHosts(config.allowedHosts);
  const { terminals } = context;
  const handleApi = createApiRoutes(
    context,
    terminals ? createTerminalRoutes(context.engine, terminals) : []
  );
  const hub = createSocketHub(
    context.engine,
    context.transcripts,
    context.accounts,
    context.classify ?? null,
    terminals
  );
  const terminalSockets = terminals ? createTerminalSockets(terminals) : null;

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

  const server = Bun.serve<ServerSocketData>({
    port: config.port,
    hostname: config.hostname,
    maxRequestBodySize: ATTACHMENT_REQUEST_LIMIT_BYTES,
    fetch(request, bunServer) {
      const url = new URL(request.url);
      const outside = respondOutside(request, url);
      if (outside) return outside;
      const refusal = resolveRefusal(request, allowedHosts);
      if (refusal) return respondError('forbidden', refusal, 403);
      if (url.pathname === '/ws')
        return upgrade(request, bunServer, { kind: 'hub', transcripts: new Map(), surface: null });
      const terminalId = terminalSockets ? readTerminalSocketId(url.pathname) : null;
      if (terminalId) return upgrade(request, bunServer, { kind: 'terminal', terminalId, viewer: null });
      if (url.pathname.startsWith('/api/')) return respondApi(request, url);
      return serveStatic(config.webDir, url.pathname);
    },
    websocket: {
      ...createSocketHandlers(hub, terminalSockets),
      maxPayloadLength: MAX_BODY_BYTES,
    },
  });
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
