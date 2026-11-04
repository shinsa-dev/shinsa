import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  isRelayedRequest,
  type RelayClients,
  relayRequest,
  serveRelayedRequests,
  startServiceWorker,
} from '@/lib/remote/relay.ts';

function createPage(respond: (request: Request) => Promise<Response>) {
  const target = new EventTarget();
  const serving = Effect.runFork(serveRelayedRequests(target as unknown as ServiceWorkerContainer, respond));
  const stop = () => serving.interruptUnsafe();
  const clients: RelayClients = {
    get: (id) =>
      Promise.resolve(
        id === 'page'
          ? {
              postMessage: (data: unknown, transfer: Transferable[]) => {
                const ports = transfer.filter((item) => !(item instanceof ArrayBuffer));
                target.dispatchEvent(Object.assign(new Event('message'), { data, ports }));
              },
            }
          : undefined
      ),
  };
  return { clients, stop, target };
}

function relay(request: Request, clientId: string, clients: RelayClients) {
  return Effect.runPromise(relayRequest(request, clientId, clients));
}

function startWorker(container: unknown) {
  return Effect.runPromise(startServiceWorker(container as ServiceWorkerContainer, '/sw.js', '/'));
}

describe('the service worker relay', () => {
  it('relays only this site’s /api requests', () => {
    expect(isRelayedRequest(new Request('https://app.shinsa.dev/api/tasks'), 'https://app.shinsa.dev')).toBe(
      true
    );
    expect(
      isRelayedRequest(new Request('https://app.shinsa.dev/assets/a.js'), 'https://app.shinsa.dev')
    ).toBe(false);
    expect(isRelayedRequest(new Request('https://other.dev/api/tasks'), 'https://app.shinsa.dev')).toBe(
      false
    );
  });

  it('never relays a navigation, so nothing a machine answers opens as a page of this site', () => {
    const address = 'https://app.shinsa.dev/api/evidence/a.svg';
    const opened = Object.defineProperty(new Request(address), 'mode', { value: 'navigate' });
    expect(isRelayedRequest(new Request(address), 'https://app.shinsa.dev')).toBe(true);
    expect(isRelayedRequest(opened, 'https://app.shinsa.dev')).toBe(false);
  });

  it('sandboxes every relayed answer whatever headers the machine sent', async () => {
    const { clients, stop } = createPage(() =>
      Promise.resolve(
        new Response('<svg onload="alert(1)"/>', {
          headers: {
            'content-type': 'image/svg+xml',
            'content-security-policy': "script-src 'unsafe-inline'",
          },
        })
      )
    );
    const answer = await relay(new Request('https://app.shinsa.dev/api/evidence/a.svg'), 'page', clients);
    expect(answer.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('content-type')).toBe('image/svg+xml');
    const empty = await relay(
      new Request('https://app.shinsa.dev/api/x'),
      'page',
      createPage(() => Promise.resolve(new Response(null, { status: 204 }))).clients
    );
    expect(empty.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    stop();
  });

  it('hands a request to the page and streams the page’s answer back', async () => {
    const seen: string[] = [];
    const { clients, stop } = createPage(async (request) => {
      seen.push(`${request.method} ${request.url} ${await request.text()}`);
      return new Response('hello from the machine', { status: 201, headers: { 'x-mac': '1' } });
    });
    const response = await relay(
      new Request('https://shinsa.dev/api/commands', { method: 'POST', body: 'payload' }),
      'page',
      clients
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('x-mac')).toBe('1');
    expect(await response.text()).toBe('hello from the machine');
    expect(seen).toEqual(['POST https://shinsa.dev/api/commands payload']);
    const image = await relay(new Request('https://shinsa.dev/api/evidence/a.png'), 'page', clients);
    expect(await image.text()).toBe('hello from the machine');
    stop();
  });

  it('answers 503 when no page sent it or the page could not reach the machine', async () => {
    const { clients } = createPage(() => Promise.reject(new Error('Couldn’t reach your machine.')));
    const orphan = await relay(new Request('https://shinsa.dev/api/x'), '', clients);
    expect(orphan.status).toBe(503);
    const gone = await relay(new Request('https://shinsa.dev/api/x'), 'closed-tab', clients);
    expect(gone.status).toBe(503);
    const failed = await relay(new Request('https://shinsa.dev/api/x'), 'page', clients);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: { code: 'remote_unavailable', message: 'Couldn’t reach your machine.' },
    });
    const { clients: thrown } = createPage(() => Promise.reject('no reason'));
    const unnamed = await relay(new Request('https://shinsa.dev/api/x'), 'page', thrown);
    expect(((await unnamed.json()) as { error: { message: string } }).error.message).toBe(
      'The request to your machine failed.'
    );
  });

  it('answers 503 when the worker cannot look up the page that sent it', async () => {
    const lost: RelayClients = { get: () => Promise.reject(new Error('The page is gone.')) };
    const answer = await relay(new Request('https://shinsa.dev/api/x'), 'page', lost);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({
      error: { code: 'remote_unavailable', message: 'The page is gone.' },
    });
  });

  it('keeps a body-less status bodiless, and fails a stream that breaks halfway', async () => {
    const empty = createPage(() => Promise.resolve(new Response(null, { status: 204 })));
    expect((await relay(new Request('https://shinsa.dev/api/x'), 'page', empty.clients)).status).toBe(204);
    const broken = createPage(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode('part'));
              controller.error(new Error('The connection to your machine broke.'));
            },
          })
        )
      )
    );
    const response = await relay(new Request('https://shinsa.dev/api/x'), 'page', broken.clients);
    await expect(response.text()).rejects.toThrow('broke');
  });

  it('aborts the page’s request when the browser gives up on it or cancels its body', async () => {
    const aborts: string[] = [];
    let release = () => {};
    const { clients } = createPage((request) => {
      request.signal.addEventListener('abort', () => aborts.push(request.url));
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start: (stream) => {
              stream.enqueue(new TextEncoder().encode('first'));
              release = () => stream.enqueue(new TextEncoder().encode('more'));
            },
          })
        )
      );
    });
    const controller = new AbortController();
    const response = await relay(
      new Request('https://shinsa.dev/api/stream', { signal: controller.signal }),
      'page',
      clients
    );
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    controller.abort();
    await Bun.sleep(5);
    expect(aborts).toEqual(['https://shinsa.dev/api/stream']);
    release();
    await reader.cancel();
  });

  it('ignores messages that are not relayed requests', () => {
    const { target, stop } = createPage(() => Promise.resolve(new Response('x')));
    target.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'other' }, ports: [] }));
    target.dispatchEvent(Object.assign(new Event('message'), { data: null, ports: [] }));
    stop();
  });
});

describe('starting the service worker', () => {
  function createContainer(controlled: boolean) {
    const target = new EventTarget();
    const registered: string[] = [];
    const container = {
      register: (url: string, options: RegistrationOptions) => {
        registered.push(`${url} ${options.scope}`);
        return Promise.resolve({} as ServiceWorkerRegistration);
      },
      ready: Promise.resolve({} as ServiceWorkerRegistration),
      controller: controlled ? ({} as ServiceWorker) : null,
      addEventListener: target.addEventListener.bind(target),
    };
    return { container, registered, target };
  }

  it('registers it for the dashboard’s path and goes on at once when it already controls the page', async () => {
    const { container, registered } = createContainer(true);
    await startWorker(container);
    expect(registered).toEqual(['/sw.js /']);
  });

  it('fails with the browser’s reason when it cannot register', async () => {
    const { container } = createContainer(true);
    const refused = { ...container, register: () => Promise.reject(new Error('Service workers are off.')) };
    await expect(startWorker(refused)).rejects.toThrow('Service workers are off.');
  });

  it('waits for it to take control of a page it does not control yet', async () => {
    const { container, target } = createContainer(false);
    let started = false;
    const starting = startWorker(container).then(() => {
      started = true;
    });
    await Bun.sleep(1);
    expect(started).toBe(false);
    target.dispatchEvent(new Event('controllerchange'));
    await starting;
    expect(started).toBe(true);
  });
});
