import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { createApiClient, createSurfaceClient, NOT_RUNNING } from '../../src/cli/api.ts';

interface Seen {
  method: string;
  path: string;
  key: string | null;
  type: string | null;
  body: unknown;
}

const servers: { stop: (force?: boolean) => unknown }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serve(answer: (request: Request) => Response) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const text = await request.text();
      seen.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        key: request.headers.get('idempotency-key'),
        type: request.headers.get('content-type'),
        body: text ? JSON.parse(text) : null,
      });
      return answer(request);
    },
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, seen };
}

describe('the surface client', () => {
  test('every command of one invocation carries the key, the second and later ones numbered', async () => {
    const { base, seen } = serve(() => Response.json({ ok: true, taskId: 'task-1' }));
    const client = createSurfaceClient(base, 'cli:abc');
    expect(await client.send({ type: 'task.cancel', taskId: 'task-1' })).toEqual({
      ok: true,
      taskId: 'task-1',
    });
    await client.send({ type: 'task.complete', taskId: 'task-1' });
    await client.send({ type: 'task.complete', taskId: 'task-2' });
    expect(seen.map((request) => [request.path, request.key, request.type])).toEqual([
      ['/api/commands', 'cli:abc', 'application/json'],
      ['/api/commands', 'cli:abc:1', 'application/json'],
      ['/api/commands', 'cli:abc:2', 'application/json'],
    ]);
    expect(seen[0]?.body).toEqual({ type: 'task.cancel', taskId: 'task-1' });
    expect(client.base).toBe(base);
  });

  test('reads are plain GETs and posts send JSON without a key', async () => {
    const { base, seen } = serve(() => Response.json({ fine: true }));
    const client = createSurfaceClient(base, 'cli:abc');
    expect(await client.read('/api/tasks?status=all')).toEqual({ fine: true });
    expect(await client.post('/api/accounts/refresh', { now: 1 })).toEqual({ fine: true });
    expect(seen).toEqual([
      {
        method: 'GET',
        path: '/api/tasks?status=all',
        key: null,
        type: null,
        body: null,
      },
      {
        method: 'POST',
        path: '/api/accounts/refresh',
        key: null,
        type: 'application/json',
        body: { now: 1 },
      },
    ]);
  });

  test('an error body becomes a DomainError with the server’s code, or request_failed without one', async () => {
    const { base } = serve((request) =>
      new URL(request.url).pathname === '/coded'
        ? Response.json({ error: { code: 'task_not_found', message: 'No task x.' } }, { status: 400 })
        : Response.json({ error: { message: 'Something broke.' } }, { status: 500 })
    );
    const client = createSurfaceClient(base, 'cli:abc');
    const coded = await client.read('/coded').catch((error: unknown) => error);
    expect(coded).toBeInstanceOf(DomainError);
    expect(coded).toMatchObject({ code: 'task_not_found', message: 'No task x.' });
    expect(await client.read('/plain').catch((error: unknown) => error)).toMatchObject({
      code: 'request_failed',
      message: 'Something broke.',
    });
  });

  test('a server that is not running, or answers without JSON, is explained', async () => {
    const { base } = serve(() => new Response('down', { status: 502 }));
    await expect(createSurfaceClient(base, 'k').read('/api/queue')).rejects.toThrow(
      `Shinsa on ${base} answered 502 without JSON.`
    );
    await expect(createSurfaceClient('http://127.0.0.1:1', 'k').read('/api/queue')).rejects.toThrow(
      NOT_RUNNING
    );
  });
  test('a request the engine does not answer wakes it once, then tries again', async () => {
    const { base } = serve(() => Response.json({ ok: true }));
    let wakes = 0;
    const wakeOnto = (target: string) => {
      const client = createSurfaceClient(target, 'k', () => {
        wakes += 1;
        return Promise.resolve(target === base ? true : wakes > 1);
      });
      return client;
    };
    await expect(wakeOnto(base).read('/api/health')).resolves.toEqual({ ok: true });
    await expect(wakeOnto('http://127.0.0.1:1').read('/api/health')).rejects.toThrow(NOT_RUNNING);
    await expect(wakeOnto('http://127.0.0.1:1').read('/api/health')).rejects.toThrow(NOT_RUNNING);
    expect(wakes).toBe(2);
    expect(createApiClient(base, () => Promise.resolve(false)).base).toBe(base);
  });
});

describe('the api client', () => {
  test('reads the queue and sends commands under a fresh cli: key per client', async () => {
    const { base, seen } = serve(() => Response.json({ ok: true, taskId: null }));
    const first = createApiClient(base);
    await first.readQueue();
    await first.sendCommand({ type: 'task.cancel', taskId: 'task-1' });
    await createApiClient(base).sendCommand({ type: 'task.cancel', taskId: 'task-1' });
    expect(seen[0]?.path).toBe('/api/queue');
    const keys = seen.slice(1).map((request) => request.key ?? '');
    expect(keys[0]).toMatch(/^cli:[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^cli:[0-9a-f-]{36}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
