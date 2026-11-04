import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError, type UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
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
    expect(
      await Effect.runPromise(client.send({ type: 'task.cancel', taskId: 'task-1' } as UserCommand))
    ).toEqual({
      ok: true,
      taskId: 'task-1',
    });
    await Effect.runPromise(client.send({ type: 'task.complete', taskId: 'task-1' } as UserCommand));
    await Effect.runPromise(client.send({ type: 'task.complete', taskId: 'task-2' } as UserCommand));
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
    expect<unknown>(await Effect.runPromise(client.api.tasks.list({ query: { status: 'all' } }))).toEqual({
      fine: true,
    });
    expect<unknown>(
      await Effect.runPromise(client.api.accounts.refresh({ payload: { scope: 'now' } }))
    ).toEqual({ fine: true });
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
        body: { scope: 'now' },
      },
    ]);
  });

  test('an error body becomes a DomainError with the server’s code, or request_failed without one', async () => {
    const { base } = serve((request) =>
      new URL(request.url).pathname === '/api/queue'
        ? Response.json({ error: { code: 'task_not_found', message: 'No task x.' } }, { status: 400 })
        : Response.json({ error: { message: 'Something broke.' } }, { status: 500 })
    );
    const client = createSurfaceClient(base, 'cli:abc');
    const coded = await Effect.runPromise(Effect.flip(client.api.server.queue()));
    expect(coded).toBeInstanceOf(DomainError);
    expect(coded).toMatchObject({ code: 'task_not_found', message: 'No task x.' });
    expect(await Effect.runPromise(Effect.flip(client.api.state.repos()))).toMatchObject({
      code: 'request_failed',
      message: 'Something broke.',
    });
  });

  test('a server that is not running, or answers without JSON, is explained', async () => {
    const { base } = serve(() => new Response('down', { status: 502 }));
    await expect(Effect.runPromise(createSurfaceClient(base, 'k').api.server.queue())).rejects.toThrow(
      `Shinsa on ${base} answered 502 without JSON.`
    );
    await expect(
      Effect.runPromise(createSurfaceClient('http://127.0.0.1:1', 'k').api.server.queue())
    ).rejects.toThrow(NOT_RUNNING);
    const plain = serve(() => new Response('fine', { status: 200 }));
    await expect(Effect.runPromise(createSurfaceClient(plain.base, 'k').api.server.queue())).rejects.toThrow(
      `Shinsa on ${plain.base} answered without JSON.`
    );
  });
  test('a request the engine does not answer wakes it once, then tries again', async () => {
    const { base } = serve(() => Response.json({ ok: true }));
    let wakes = 0;
    const wakeOnto = (target: string) => {
      const client = createSurfaceClient(
        target,
        'k',
        Effect.sync(() => {
          wakes += 1;
          return target === base ? true : wakes > 1;
        })
      );
      return client;
    };
    expect<unknown>(await Effect.runPromise(wakeOnto(base).api.server.health())).toEqual({ ok: true });
    await expect(Effect.runPromise(wakeOnto('http://127.0.0.1:1').api.server.health())).rejects.toThrow(
      NOT_RUNNING
    );
    await expect(Effect.runPromise(wakeOnto('http://127.0.0.1:1').api.server.health())).rejects.toThrow(
      NOT_RUNNING
    );
    expect(wakes).toBe(2);
    expect(createApiClient(base, Effect.succeed(false)).base).toBe(base);
  });
});

describe('the api client', () => {
  test('reads the queue and sends commands under a fresh cli: key per client', async () => {
    const { base, seen } = serve(() => Response.json({ ok: true, taskId: null }));
    const first = createApiClient(base);
    await Effect.runPromise(first.readQueue());
    await Effect.runPromise(first.sendCommand({ type: 'task.cancel', taskId: 'task-1' } as UserCommand));
    await Effect.runPromise(first.readRepos());
    await Effect.runPromise(
      createApiClient(base).sendCommand({ type: 'task.cancel', taskId: 'task-1' } as UserCommand)
    );
    expect(seen.map((request) => request.path)).toEqual([
      '/api/queue',
      '/api/commands',
      '/api/repos',
      '/api/commands',
    ]);
    const keys = [seen[1], seen[3]].map((request) => request?.key ?? '');
    expect(keys[0]).toMatch(/^cli:[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^cli:[0-9a-f-]{36}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
