import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { EngineGate } from '@shinsa/core/engine-api';
import {
  AnyBody,
  BrowserOnlyRoute,
  CommandHeaders,
  GuestRoute,
  LocalOnlyRoute,
  RequestBodyLimit,
  RouteFieldFailures,
} from '@shinsa/core/engine-api/schema';
import { Effect, Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { EngineGateLive } from '../../src/http/gate/middleware.ts';
import type { RequestSourceShape } from '../../src/http/schema.ts';
import { createHttpContext, createWebHandler, disposeWebHandlers, recordedLogs } from '../helpers/web.ts';

afterEach(disposeWebHandlers);

const BASE = 'http://127.0.0.1:5180';

const Answer = Schema.Struct({ ok: Schema.Boolean });

class GateGroup extends HttpApiGroup.make('gate')
  .add(
    HttpApiEndpoint.post('open', '/api/test/open', {
      payload: Schema.Struct({
        target: Schema.Literals(['editor', 'finder']),
        note: Schema.optionalKey(Schema.String),
      }),
      success: Answer,
    })
      .annotate(LocalOnlyRoute, true)
      .annotate(RouteFieldFailures, {
        target: { code: 'target_invalid', message: 'Pick the editor or Finder.' },
      }),
    HttpApiEndpoint.post('upload', '/api/test/upload', { payload: AnyBody, success: Answer }).annotate(
      RequestBodyLimit,
      2 * 1024 * 1024
    ),
    HttpApiEndpoint.post('install', '/api/test/install', { payload: AnyBody, success: Answer }).annotate(
      BrowserOnlyRoute,
      'Only Shinsa’s own page installs.'
    ),
    HttpApiEndpoint.post('privacy', '/api/test/privacy', { success: Answer }),
    HttpApiEndpoint.post('send', '/api/test/send', {
      headers: CommandHeaders,
      payload: Schema.Unknown,
      success: Answer,
    }).annotate(RouteFieldFailures, {
      'idempotency-key': { code: 'idempotency_key_invalid', message: 'The key is too long.' },
    }),
    HttpApiEndpoint.get('task', '/api/tasks/:taskRef', {
      params: { taskRef: Schema.String },
      success: Answer,
    }).annotate(GuestRoute, 'own_task'),
    HttpApiEndpoint.get('health', '/api/health', { success: Answer }).annotate(GuestRoute, 'any'),
    HttpApiEndpoint.get('page', '/api/test/page/:number', {
      params: { number: Schema.Literals(['1', '2']) },
      query: { limit: Schema.optionalKey(Schema.Literals(['3'])) },
      success: Answer,
    }),
    HttpApiEndpoint.get('refused', '/api/test/refused', { success: Answer }),
    HttpApiEndpoint.get('broken', '/api/test/broken', { success: Answer }),
    HttpApiEndpoint.get('wrong', '/api/test/wrong', { success: Answer })
  )
  .middleware(EngineGate) {}

class GateApi extends HttpApi.make('gate-test').add(GateGroup) {}

const GateHandlers = HttpApiBuilder.group(GateApi, 'gate', (handlers) =>
  handlers
    .handle('open', () => Effect.succeed({ ok: true }))
    .handle('upload', () => Effect.succeed({ ok: true }))
    .handle('install', () => Effect.succeed({ ok: true }))
    .handle('privacy', () => Effect.succeed({ ok: true }))
    .handle('send', () => Effect.succeed({ ok: true }))
    .handle('task', () => Effect.succeed({ ok: true }))
    .handle('health', () => Effect.succeed({ ok: true }))
    .handle('page', () => Effect.succeed({ ok: true }))
    .handle('refused', () =>
      Effect.die(new DomainError({ code: 'task_settled', message: 'The task is done.' }))
    )
    .handle('broken', () => Effect.die(new Error('The disk is full.')))
    .handle('wrong', () => Effect.succeed({ ok: 'yes' } as unknown as { ok: boolean }))
);

const GateRoutes = HttpApiBuilder.layer(GateApi).pipe(
  Layer.provide(GateHandlers),
  Layer.provide(EngineGateLive)
);

function createGate(config = {}) {
  const context = createHttpContext({}, config);
  return createWebHandler(context, GateRoutes);
}

function post(path: string, body: string | ReadableStream, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { host: '127.0.0.1:5180', 'content-type': 'application/json', ...headers },
    body,
  });
}

function get(path: string) {
  return new Request(`${BASE}${path}`, { headers: { host: '127.0.0.1:5180' } });
}

async function readFailure(response: Response) {
  return [response.status, ((await response.json()) as { error: unknown }).error];
}

const OWNER: RequestSourceShape = { via: 'channel', guest: null };

const GUEST = { via: 'channel', guest: { taskId: 'task-1' } } as unknown as RequestSourceShape;

describe('the request gate', () => {
  test('a payload is decoded, and a field’s own failure names what to fix', async () => {
    const handle = createGate();
    expect(await (await handle(post('/api/test/open', '{"target":"editor"}'))).json()).toEqual({ ok: true });
    expect(await readFailure(await handle(post('/api/test/open', '{"target":"vim"}')))).toEqual([
      400,
      { code: 'target_invalid', message: 'Pick the editor or Finder.' },
    ]);
    expect(await readFailure(await handle(post('/api/test/open', '{"target":"editor","note":4}')))).toEqual([
      400,
      { code: 'body_invalid', message: 'The field note is not valid: Expected string.' },
    ]);
    expect(await readFailure(await handle(post('/api/test/upload', '[1]')))).toEqual([
      400,
      { code: 'body_invalid', message: 'The request body must be an object.' },
    ]);
  });

  test('a body that is not JSON, or is empty, is refused as body_invalid', async () => {
    const handle = createGate();
    for (const body of ['{', '']) {
      expect(await readFailure(await handle(post('/api/test/upload', body)))).toEqual([
        400,
        { code: 'body_invalid', message: 'The request body is not valid JSON.' },
      ]);
    }
  });

  test('a write must be JSON and within its route’s limit, declared or read', async () => {
    const handle = createGate();
    expect(
      await readFailure(await handle(post('/api/test/upload', '{}', { 'content-type': 'text/plain' })))
    ).toEqual([415, { code: 'content_type_invalid', message: 'Send the request body as application/json.' }]);
    const declared = post('/api/test/upload', '{}', { 'content-length': String(3 * 1024 * 1024) });
    expect(await readFailure(await handle(declared))).toEqual([
      413,
      { code: 'body_too_large', message: 'The request body is over 2 MB.' },
    ]);
    const chunks = [new TextEncoder().encode(`{"a":"${'x'.repeat(2 * 1024 * 1024)}"}`)];
    const streamed = post(
      '/api/test/upload',
      new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
      })
    );
    expect(await readFailure(await handle(streamed))).toEqual([
      400,
      { code: 'body_too_large', message: 'The request body is over 2 MB.' },
    ]);
    expect((await handle(post('/api/test/privacy', ''))).status).toBe(200);
  });

  test('a route only a page may call refuses a request without an Origin', async () => {
    const handle = createGate();
    expect(await readFailure(await handle(post('/api/test/install', '{}')))).toEqual([
      400,
      { code: 'browser_only', message: 'Only Shinsa’s own page installs.' },
    ]);
    expect((await handle(post('/api/test/install', '{}', { origin: 'http://localhost:5181' }))).status).toBe(
      200
    );
  });

  test('a header, a path and a query that do not decode answer their own way', async () => {
    const handle = createGate();
    expect(
      await readFailure(await handle(post('/api/test/send', '{}', { 'idempotency-key': 'k'.repeat(201) })))
    ).toEqual([400, { code: 'idempotency_key_invalid', message: 'The key is too long.' }]);
    expect(await readFailure(await handle(get('/api/test/page/abc')))).toEqual([
      404,
      { code: 'not_found', message: 'No such endpoint.' },
    ]);
    const query = await readFailure(await handle(get('/api/test/page/2?limit=many')));
    expect(query[0]).toBe(400);
    expect(query[1]).toMatchObject({ code: 'body_invalid' });
    expect((await handle(get('/api/test/page/2?limit=3'))).status).toBe(200);
  });

  test('a handler that throws answers 400 with its code, or request_failed', async () => {
    const handle = createGate();
    expect(await readFailure(await handle(get('/api/test/refused')))).toEqual([
      400,
      { code: 'task_settled', message: 'The task is done.' },
    ]);
    expect(await readFailure(await handle(get('/api/test/broken')))).toEqual([
      400,
      { code: 'request_failed', message: 'The disk is full.' },
    ]);
    expect(recordedLogs).toContainEqual({
      message: '[Server] Request failed',
      fields: { path: '/api/test/broken', error: 'The disk is full.' },
    });
    expect((await handle(get('/api/test/wrong'))).status).toBe(400);
  });

  test('through the channel a local-only route is refused, and a guest reaches only their task', async () => {
    const handle = createGate();
    expect(await readFailure(await handle(post('/api/test/open', '{"target":"editor"}'), OWNER))).toEqual([
      403,
      { code: 'local_only', message: 'Do this on the machine Shinsa runs on.' },
    ]);
    expect((await handle(get('/api/health'), GUEST)).status).toBe(200);
    expect((await handle(get('/api/tasks/task-1'), GUEST)).status).toBe(200);
    expect((await handle(get('/api/tasks/task-2'), OWNER)).status).toBe(200);
    expect(await readFailure(await handle(get('/api/tasks/task-2'), GUEST))).toMatchObject([
      403,
      { code: 'handoff_scope' },
    ]);
    expect(await readFailure(await handle(post('/api/test/upload', '{}'), GUEST))).toMatchObject([
      403,
      { code: 'handoff_scope' },
    ]);
  });
});
