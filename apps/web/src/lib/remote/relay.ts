import { Effect, Predicate, Stream } from 'effect';
import { RELAY_FAILED, RELAY_NO_PAGE, RelayFailed } from './schema.ts';

const RELAY_REQUEST = 'shinsa-remote-request';

const RELAYED_PREFIX = '/api/';

interface RelayedRequest {
  type: typeof RELAY_REQUEST;
  method: string;
  url: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

type RelayAnswer =
  | { type: 'head'; status: number; headers: [string, string][] }
  | { type: 'chunk'; bytes: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; message: string };

export interface RelayClients {
  get: (
    id: string
  ) => Promise<{ postMessage: (message: unknown, transfer: Transferable[]) => void } | undefined>;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const RELAYED_ANSWER_HEADERS: [string, string][] = [
  ['content-security-policy', "sandbox; default-src 'none'"],
  ['x-content-type-options', 'nosniff'],
];

function resolveRelayedHeaders(source: [string, string][]) {
  const headers = new Headers(source);
  for (const [name, value] of RELAYED_ANSWER_HEADERS) headers.set(name, value);
  return headers;
}

function resolveRelayFailure(error: unknown) {
  return new RelayFailed({ message: Predicate.isError(error) ? error.message : RELAY_FAILED });
}

function enterRelay<A>(step: () => Promise<A>) {
  return Effect.tryPromise({ try: step, catch: resolveRelayFailure });
}

export function isRelayedRequest(request: Request, origin: string) {
  const url = new URL(request.url);
  return request.mode !== 'navigate' && url.origin === origin && url.pathname.startsWith(RELAYED_PREFIX);
}

function respondUnavailable(message: string) {
  return new Response(JSON.stringify({ error: { code: 'remote_unavailable', message } }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}

function awaitRelayAnswer(port: MessagePort) {
  return Effect.callback<Response>((resume) => {
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    port.onmessage = (event: MessageEvent<RelayAnswer>) => {
      const answer = event.data;
      switch (answer.type) {
        case 'head': {
          const headers = resolveRelayedHeaders(answer.headers);
          if (NULL_BODY_STATUSES.has(answer.status)) {
            port.close();
            resume(Effect.succeed(new Response(null, { status: answer.status, headers })));
            return;
          }
          const streamed = new ReadableStream<Uint8Array>({
            start: (controller) => {
              stream = controller;
            },
            cancel: () => {
              port.postMessage({ type: 'abort' });
              port.close();
            },
          });
          resume(Effect.succeed(new Response(streamed, { status: answer.status, headers })));
          return;
        }
        case 'chunk':
          stream?.enqueue(answer.bytes);
          return;
        case 'end':
          stream?.close();
          port.close();
          return;
        case 'error':
          if (stream) stream.error(new Error(answer.message));
          else resume(Effect.succeed(respondUnavailable(answer.message)));
          port.close();
          return;
      }
    };
  });
}

export const relayRequest = Effect.fn('Relay.relayRequest')(
  function* (request: Request, clientId: string, clients: RelayClients) {
    if (!clientId) return respondUnavailable(RELAY_NO_PAGE);
    const client = yield* enterRelay(() => clients.get(clientId));
    if (!client) return respondUnavailable(RELAY_NO_PAGE);
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const body = hasBody ? yield* enterRelay(() => request.arrayBuffer()) : null;
    const { port1, port2 } = new MessageChannel();
    const message: RelayedRequest = {
      type: RELAY_REQUEST,
      method: request.method,
      url: request.url,
      headers: [...request.headers.entries()],
      body,
    };
    client.postMessage(message, body ? [port2, body] : [port2]);
    request.signal.addEventListener('abort', () => port1.postMessage({ type: 'abort' }), { once: true });
    return yield* awaitRelayAnswer(port1);
  },
  Effect.catchTag('RelayFailed', (error) => Effect.succeed(respondUnavailable(error.message)))
);

function isRelayedMessage(value: unknown): value is RelayedRequest {
  return Predicate.hasProperty(value, 'type') && value.type === RELAY_REQUEST;
}

function answerRelayed(
  request: RelayedRequest,
  port: MessagePort,
  respond: (request: Request) => Promise<Response>
) {
  const controller = new AbortController();
  port.onmessage = (event: MessageEvent<{ type?: string }>) => {
    if (event.data.type === 'abort') controller.abort();
  };
  return Effect.gen(function* () {
    const response = yield* enterRelay(() =>
      respond(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
          signal: controller.signal,
        })
      )
    );
    port.postMessage({ type: 'head', status: response.status, headers: [...response.headers.entries()] });
    const body = response.body;
    if (body) {
      yield* Stream.fromReadableStream({ evaluate: () => body, onError: resolveRelayFailure }).pipe(
        Stream.takeWhile(() => !controller.signal.aborted),
        Stream.runForEach((bytes) =>
          Effect.sync(() => {
            const copy = bytes.slice();
            port.postMessage({ type: 'chunk', bytes: copy }, [copy.buffer]);
          })
        )
      );
    }
    port.postMessage({ type: 'end' });
  }).pipe(
    Effect.catchTag('RelayFailed', (error) =>
      Effect.sync(() => port.postMessage({ type: 'error', message: error.message }))
    ),
    Effect.ensuring(Effect.sync(() => port.close()))
  );
}

export const serveRelayedRequests = Effect.fn('Relay.serveRelayedRequests')(function* (
  target: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>,
  respond: (request: Request) => Promise<Response>
) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const listener = (event: MessageEvent) => {
    const port = event.ports[0];
    if (!(isRelayedMessage(event.data) && port)) return;
    run(answerRelayed(event.data, port, respond));
  };
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => target.addEventListener('message', listener as EventListener)),
    () => Effect.never,
    () => Effect.sync(() => target.removeEventListener('message', listener as EventListener))
  );
});

export const startServiceWorker = Effect.fn('Relay.startServiceWorker')(function* (
  container: Pick<ServiceWorkerContainer, 'register' | 'ready' | 'controller' | 'addEventListener'>,
  url: string,
  scope: string
) {
  yield* enterRelay(() => container.register(url, { scope, type: 'module' }));
  yield* enterRelay(() => container.ready);
  if (container.controller) return;
  yield* Effect.callback<void>((resume, signal) => {
    container.addEventListener('controllerchange', () => resume(Effect.void), { once: true, signal });
  });
});
