import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Effect, Ref, Stream } from 'effect';
import { describeError } from '../../../../log/index.ts';
import {
  ENDPOINT_PATH,
  KEEP_ALIVE,
  type ProgressToken,
  type ToolEndpointDefinition,
  ToolEndpointFailed,
  type ToolEndpointHandle,
} from './schema.ts';

export const makeToolEndpoint = Effect.fn('ToolEndpoint.make')(function* (
  definition: ToolEndpointDefinition
) {
  const { tools, token, heartbeat } = definition;
  const services = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(services);
  const encoder = new TextEncoder();
  const connections = yield* Ref.make<ReadonlySet<Server>>(new Set());
  const generation = yield* Ref.make(0);
  const closed = yield* Ref.make(false);

  const fail = (error: unknown) => new ToolEndpointFailed({ message: describeError(error) });

  const isInitialize = (body: unknown) => {
    const messages = Array.isArray(body) ? body : [body];
    return messages.some(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { method?: unknown }).method === 'initialize'
    );
  };

  const readProgressToken = (body: unknown): ProgressToken | null => {
    const params = (body as { params?: { _meta?: { progressToken?: unknown } } } | undefined)?.params;
    const progressToken = params?._meta?.progressToken;
    return typeof progressToken === 'string' || typeof progressToken === 'number' ? progressToken : null;
  };

  const encodeProgress = (progressToken: ProgressToken, progress: number) => {
    const message = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress } };
    return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  };

  const readBody = (request: Request) =>
    request.method === 'POST'
      ? Effect.tryPromise({ try: () => request.clone().json() as Promise<unknown>, catch: fail }).pipe(
          Effect.orElseSucceed(() => undefined)
        )
      : Effect.succeed(undefined);

  const closeServer = (server: Server) =>
    Effect.ignore(Effect.tryPromise({ try: () => server.close(), catch: fail }));

  const release = (server: Server) =>
    Ref.update(connections, (open) => new Set([...open].filter((other) => other !== server))).pipe(
      Effect.andThen(closeServer(server))
    );

  const streamUntilDone = Effect.fn('ToolEndpoint.streamUntilDone')(function* (
    response: Response,
    progressToken: ProgressToken | null,
    server: Server
  ) {
    const body = response.body;
    if (!body) {
      yield* release(server);
      return response;
    }
    const chunks = Stream.fromReadableStream({ evaluate: () => body, onError: fail });
    const beats = Stream.tick(heartbeat).pipe(
      Stream.drop(1),
      Stream.zipWithIndex,
      Stream.map(([, index]) =>
        progressToken === null ? KEEP_ALIVE : encodeProgress(progressToken, index + 1)
      )
    );
    const eventStream = response.headers.get('content-type')?.includes('text/event-stream') === true;
    const stream = eventStream
      ? Stream.concat(Stream.succeed(KEEP_ALIVE), Stream.merge(chunks, beats, { haltStrategy: 'left' }))
      : chunks;
    return new Response(
      Stream.toReadableStreamWith(stream.pipe(Stream.ensuring(release(server))), services),
      { status: response.status, headers: response.headers }
    );
  });

  const respond = Effect.fn('ToolEndpoint.respond')(function* (request: Request) {
    if (request.headers.get('authorization') !== `Bearer ${token}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (new URL(request.url).pathname !== ENDPOINT_PATH) return new Response('Not found', { status: 404 });
    if (request.headers.has('origin')) return new Response('Forbidden', { status: 403 });
    const parsedBody = yield* readBody(request);
    const scope = String(
      isInitialize(parsedBody)
        ? yield* Ref.updateAndGet(generation, (count) => count + 1)
        : yield* Ref.get(generation)
    );
    const server = tools.createServer({ scope: () => scope });
    yield* Ref.update(connections, (open) => new Set(open).add(server));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    yield* Effect.tryPromise({ try: () => server.connect(transport), catch: fail });
    const response = yield* Effect.tryPromise({
      try: () => transport.handleRequest(request, { parsedBody }),
      catch: fail,
    });
    return yield* streamUntilDone(response, readProgressToken(parsedBody), server);
  });

  const http = yield* Effect.try({
    try: () =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        idleTimeout: 0,
        fetch: (request) => runPromise(respond(request)),
      }),
    catch: fail,
  });

  const close = Effect.gen(function* () {
    if (yield* Ref.getAndSet(closed, true)) return;
    yield* Effect.forkDetach(Effect.ignore(Effect.tryPromise({ try: () => http.stop(true), catch: fail })));
    const open = yield* Ref.getAndSet(connections, new Set());
    yield* Effect.forEach(open, (server) => Effect.forkDetach(closeServer(server)), { discard: true });
  });

  const handle: ToolEndpointHandle = {
    url: `http://127.0.0.1:${http.port}${ENDPOINT_PATH}`,
    headers: { Authorization: `Bearer ${token}` },
    close,
  };
  return handle;
});
