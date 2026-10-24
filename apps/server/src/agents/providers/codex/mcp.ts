import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ShinsaTools } from '../../tools/index.ts';

export interface ToolEndpoint {
  url: string;
  headers: Record<string, string>;
  close: () => void;
}

export interface ToolEndpointOptions {
  heartbeatMs?: number;
}

const HEARTBEAT_MS = 10_000;

const PATH = '/mcp';

function isInitialize(body: unknown) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) =>
      typeof message === 'object' &&
      message !== null &&
      (message as { method?: unknown }).method === 'initialize'
  );
}

async function readBody(request: Request) {
  if (request.method !== 'POST') return undefined;
  try {
    return (await request.clone().json()) as unknown;
  } catch {
    return undefined;
  }
}

function closeServer(server: Server) {
  void server.close();
}

const encoder = new TextEncoder();

const KEEP_ALIVE = encoder.encode(': shinsa\n\n');

type ProgressToken = string | number;

function readProgressToken(body: unknown): ProgressToken | null {
  const params = (body as { params?: { _meta?: { progressToken?: unknown } } } | undefined)?.params;
  const token = params?._meta?.progressToken;
  return typeof token === 'string' || typeof token === 'number' ? token : null;
}

function encodeProgress(progressToken: ProgressToken, progress: number) {
  const message = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress } };
  return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

function isEventStream(response: Response) {
  return response.headers.get('content-type')?.includes('text/event-stream') === true;
}

interface Beat {
  ms: number;
  progressToken: ProgressToken | null;
}

function streamUntilDone(response: Response, beat: Beat, done: () => void) {
  const body = response.body;
  if (!body) {
    done();
    return response;
  }
  const reader = body.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let progress = 0;
  const stop = () => {
    clearInterval(timer);
    done();
  };
  const tick = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    progress += 1;
    controller.enqueue(
      beat.progressToken === null ? KEEP_ALIVE : encodeProgress(beat.progressToken, progress)
    );
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!isEventStream(response)) return;
      controller.enqueue(KEEP_ALIVE);
      timer = setInterval(() => tick(controller), beat.ms);
    },
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        stop();
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel() {
      await reader.cancel();
      stop();
    },
  });
  return new Response(stream, { status: response.status, headers: response.headers });
}

export function startToolEndpoint(tools: ShinsaTools, options: ToolEndpointOptions = {}): ToolEndpoint {
  const token = crypto.randomUUID();
  const connections = new Set<Server>();
  let closed = false;
  let generation = 0;
  const http = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (request.headers.get('authorization') !== `Bearer ${token}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (new URL(request.url).pathname !== PATH) return new Response('Not found', { status: 404 });
      if (request.headers.has('origin')) return new Response('Forbidden', { status: 403 });
      const parsedBody = await readBody(request);
      if (isInitialize(parsedBody)) generation += 1;
      const scope = String(generation);
      const server = tools.createServer({ scope: () => scope });
      connections.add(server);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      const beat = { ms: options.heartbeatMs ?? HEARTBEAT_MS, progressToken: readProgressToken(parsedBody) };
      return streamUntilDone(response, beat, () => {
        connections.delete(server);
        closeServer(server);
      });
    },
  });
  return {
    url: `http://127.0.0.1:${http.port}${PATH}`,
    headers: { Authorization: `Bearer ${token}` },
    close: () => {
      if (closed) return;
      closed = true;
      void http.stop(true);
      for (const server of connections) closeServer(server);
      connections.clear();
    },
  };
}
