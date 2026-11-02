import { afterEach, describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TunnelHealth } from '../../src/remote/health/service.ts';

const running: (() => Promise<void>)[] = [];

afterEach(() => Promise.all(running.splice(0).map((stop) => stop())));

function check(url: string) {
  return Effect.runPromise(
    TunnelHealth.use((health) => health.check(url)).pipe(
      Effect.provide(TunnelHealth.layer.pipe(Layer.provide(FetchHttpClient.layer)))
    )
  );
}

describe('the health ping', () => {
  test('is healthy only when the tunnel host answers 2xx', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => new Response('', { status: request.url.endsWith('/health') ? 200 : 503 }),
    });
    running.push(() => server.stop(true));
    expect(await check(`http://127.0.0.1:${server.port}/health`)).toBe(true);
    expect(await check(`http://127.0.0.1:${server.port}/down`)).toBe(false);
    expect(await check('http://127.0.0.1:1/health')).toBe(false);
  });
});
