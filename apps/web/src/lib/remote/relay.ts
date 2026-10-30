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

export function isRelayedRequest(request: Request, origin: string) {
  const url = new URL(request.url);
  return url.origin === origin && url.pathname.startsWith(RELAYED_PREFIX);
}

function respondUnavailable(message: string) {
  return new Response(JSON.stringify({ error: { code: 'remote_unavailable', message } }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}

export async function relayRequest(request: Request, clientId: string, clients: RelayClients) {
  if (!clientId) return respondUnavailable('This request came from no open Shinsa page.');
  const client = await clients.get(clientId);
  if (!client) return respondUnavailable('This request came from no open Shinsa page.');
  let body: ArrayBuffer | null = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.arrayBuffer();
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
  return new Promise<Response>((resolve) => {
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    port1.onmessage = (event: MessageEvent<RelayAnswer>) => {
      const answer = event.data;
      switch (answer.type) {
        case 'head': {
          if (NULL_BODY_STATUSES.has(answer.status)) {
            port1.close();
            resolve(new Response(null, { status: answer.status, headers: answer.headers }));
            return;
          }
          const streamed = new ReadableStream<Uint8Array>({
            start: (controller) => {
              stream = controller;
            },
            cancel: () => {
              port1.postMessage({ type: 'abort' });
              port1.close();
            },
          });
          resolve(new Response(streamed, { status: answer.status, headers: answer.headers }));
          return;
        }
        case 'chunk':
          stream?.enqueue(answer.bytes);
          return;
        case 'end':
          stream?.close();
          port1.close();
          return;
        case 'error':
          if (stream) stream.error(new Error(answer.message));
          else resolve(respondUnavailable(answer.message));
          port1.close();
          return;
      }
    };
  });
}

function isRelayedMessage(value: unknown): value is RelayedRequest {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === RELAY_REQUEST;
}

async function answerRelayed(
  request: RelayedRequest,
  port: MessagePort,
  respond: (request: Request) => Promise<Response>
) {
  const controller = new AbortController();
  port.onmessage = (event: MessageEvent<{ type?: string }>) => {
    if (event.data.type === 'abort') controller.abort();
  };
  try {
    const response = await respond(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body ? { body: request.body } : {}),
        signal: controller.signal,
      })
    );
    port.postMessage({ type: 'head', status: response.status, headers: [...response.headers.entries()] });
    if (response.body) {
      for await (const bytes of response.body) {
        if (controller.signal.aborted) break;
        const copy = bytes.slice();
        port.postMessage({ type: 'chunk', bytes: copy }, [copy.buffer]);
      }
    }
    port.postMessage({ type: 'end' });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'The request to your Mac failed.',
    });
  } finally {
    port.close();
  }
}

export function serveRelayedRequests(
  target: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>,
  respond: (request: Request) => Promise<Response>
) {
  const listener = (event: MessageEvent) => {
    const port = event.ports[0];
    if (!(isRelayedMessage(event.data) && port)) return;
    void answerRelayed(event.data, port, respond);
  };
  target.addEventListener('message', listener as EventListener);
  return () => target.removeEventListener('message', listener as EventListener);
}

export async function startServiceWorker(
  container: Pick<ServiceWorkerContainer, 'register' | 'ready' | 'controller' | 'addEventListener'>,
  url: string,
  scope: string
) {
  await container.register(url, { scope, type: 'module' });
  await container.ready;
  if (container.controller) return;
  await new Promise<void>((resolve) => {
    container.addEventListener('controllerchange', () => resolve(), { once: true });
  });
}
