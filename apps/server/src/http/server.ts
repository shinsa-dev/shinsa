import type { Transcripts } from '../agents/transcripts/index.ts';
import { respondSignInPage } from '../extensions/routes.ts';
import { describeError, log } from '../log/index.ts';
import {
  resolveAllowedHosts,
  resolveBodyRefusal,
  resolveHostRefusal,
  resolveRefusal,
  resolveUpgradeRefusal,
} from './guard.ts';
import { type ApiContext, createApiRoutes, respondError, respondFailure } from './routes.ts';
import { createSocketHub, type SocketData } from './socket.ts';
import { serveStatic } from './static.ts';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface HttpContext extends ApiContext {
  transcripts: Transcripts;
}

export function resolveServerUrl(hostname: string, port: number) {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}

export function startServer(context: HttpContext) {
  const { config } = context;
  const allowedHosts = resolveAllowedHosts(config.allowedHosts);
  const handleApi = createApiRoutes(context);
  const hub = createSocketHub(
    context.engine,
    context.transcripts,
    context.accounts,
    context.classify ?? null
  );

  async function respondApi(request: Request, url: URL) {
    const refusal = resolveBodyRefusal(request);
    if (refusal) return respondError('content_type_invalid', refusal, 415);
    try {
      return await handleApi(request, url);
    } catch (error) {
      log.warn('[Server] Request failed', { path: url.pathname, error: describeError(error) });
      return respondFailure(error);
    }
  }

  const server = Bun.serve<SocketData>({
    port: config.port,
    hostname: config.hostname,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch(request, bunServer) {
      const url = new URL(request.url);
      if (context.schedules?.isWebhook(url.pathname)) return context.schedules.handleWebhook(request, url);
      if (context.extensions?.isCallback(url.pathname) && request.method === 'GET') {
        const hostRefusal = resolveHostRefusal(request, allowedHosts);
        if (hostRefusal) return respondError('forbidden', hostRefusal, 403);
        return respondSignInPage(context.extensions, request);
      }
      const refusal = resolveRefusal(request, allowedHosts);
      if (refusal) return respondError('forbidden', refusal, 403);
      if (url.pathname === '/ws') {
        const upgradeRefusal = resolveUpgradeRefusal(request);
        if (upgradeRefusal) return respondError('forbidden', upgradeRefusal, 403);
        if (bunServer.upgrade(request, { data: { transcripts: new Map() } })) return undefined;
        return new Response('Upgrade failed', { status: 400 });
      }
      if (url.pathname.startsWith('/api/')) return respondApi(request, url);
      return serveStatic(config.webDir, url.pathname);
    },
    websocket: {
      open: hub.open,
      close: hub.close,
      message: hub.message,
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
