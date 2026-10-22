import type { Transcripts } from '../agents/transcripts/index.ts';
import { describeError, log } from '../log/index.ts';
import { resolveAllowedHosts, resolveBodyRefusal, resolveRefusal, resolveUpgradeRefusal } from './guard.ts';
import { type ApiContext, createApiRoutes, respondError, respondFailure } from './routes.ts';
import { createSocketHub, type SocketData } from './socket.ts';
import { serveStatic } from './static.ts';

export interface HttpContext extends ApiContext {
  transcripts: Transcripts;
}

export function startServer(context: HttpContext) {
  const { config } = context;
  const allowedHosts = resolveAllowedHosts(config.allowedHosts);
  const handleApi = createApiRoutes(context);
  const hub = createSocketHub(context.engine, context.transcripts);

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
    fetch(request, bunServer) {
      const url = new URL(request.url);
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
    websocket: { open: hub.open, close: hub.close, message: hub.message },
  });
  log.info('[Server] Listening', { url: `http://${config.hostname}:${server.port}` });
  return {
    server,
    stop: async () => {
      hub.stop();
      await server.stop(true);
    },
  };
}
