import { describe, expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import { Cloudflare } from '../../src/integrations/cloudflare.ts';
import { createLogRecorder, createUpstream, flipTest, runTest, type Upstream } from '../layers.ts';

const HOST = 'studio000001.shinsa.dev';

const LOCAL = 'http://127.0.0.1:7446';

function listCalls(upstream: Upstream) {
  return upstream.calls.map(
    (call) => `${call.method} ${new URL(call.url).pathname}${new URL(call.url).search}`
  );
}

function answerWith(answer: (method: string, path: string) => Response | null) {
  const upstream = createUpstream();
  upstream.handlers.push((call) => answer(call.method, new URL(call.url).pathname));
  return upstream;
}

describe('making a tunnel', () => {
  test('makes the tunnel, points its ingress at the machine, reads its token and adds its DNS record', async () => {
    const upstream = createUpstream();
    const tunnel = await runTest(
      Cloudflare.use((cloudflare) => cloudflare.createTunnel('shinsa-studio', HOST, LOCAL)),
      { upstream }
    );
    expect(tunnel.tunnelId).toBe('tunnel-1');
    expect(tunnel.dnsRecordId).toBe('record-1');
    expect(Redacted.value(tunnel.tunnelToken)).toBe('tunnel-token-1');
    expect(listCalls(upstream)).toEqual([
      'POST /client/v4/accounts/account-1/cfd_tunnel',
      'PUT /client/v4/accounts/account-1/cfd_tunnel/tunnel-1/configurations',
      'GET /client/v4/accounts/account-1/cfd_tunnel/tunnel-1/token',
      'GET /client/v4/zones?name=shinsa.dev',
      'POST /client/v4/zones/zone-1/dns_records',
    ]);
    expect(upstream.calls[0]?.headers.get('authorization')).toBe('Bearer api-token');
    expect(JSON.parse(upstream.calls[1]?.body ?? '')).toEqual({
      config: { ingress: [{ hostname: HOST, service: LOCAL }, { service: 'http_status:404' }] },
    });
    expect(JSON.parse(upstream.calls[4]?.body ?? '')).toEqual({
      type: 'CNAME',
      name: HOST,
      content: 'tunnel-1.cfargotunnel.com',
      proxied: true,
    });
  });

  test('a half-made tunnel is removed, and the first failure is the one reported', async () => {
    const upstream = answerWith((method, path) =>
      method === 'PUT' && path.endsWith('/configurations')
        ? Response.json({ success: false, errors: [{ message: 'denied' }] }, { status: 403 })
        : null
    );
    const error = await flipTest(
      Cloudflare.use((cloudflare) => cloudflare.createTunnel('shinsa-studio', HOST, LOCAL)),
      { upstream }
    );
    expect(error.message).toBe(
      'Cloudflare refused PUT /accounts/account-1/cfd_tunnel/tunnel-1/configurations: denied.'
    );
    expect(listCalls(upstream).at(-1)).toBe('DELETE /client/v4/accounts/account-1/cfd_tunnel/tunnel-1');
  });

  test('when removing the half-made tunnel fails too, that is logged and the first failure kept', async () => {
    const upstream = answerWith((method, path) => {
      if (method === 'POST' && path.endsWith('/cfd_tunnel'))
        return Response.json({ success: true, result: { id: 'x' } });
      return Response.json({ success: false, errors: [{ message: 'denied' }] }, { status: 403 });
    });
    const recorder = createLogRecorder();
    const error = await flipTest(
      Cloudflare.use((cloudflare) => cloudflare.createTunnel('shinsa-studio', HOST, LOCAL)).pipe(
        Effect.provide(recorder.layer)
      ),
      { upstream }
    );
    expect(error.message).toContain('PUT');
    expect(recorder.entries).toContainEqual({
      level: 'Error',
      message: ['[Cloud] Could not remove a half-made tunnel'],
    });
  });
});

describe('the API envelope', () => {
  test.each([
    [
      'an answer that is not JSON',
      () => new Response('<html>bad gateway</html>', { status: 502 }),
      'status 502',
    ],
    [
      'an error with no message',
      () => Response.json({ success: false, errors: [{}] }, { status: 400 }),
      'status 400',
    ],
    [
      'success without the result asked for',
      () => Response.json({ success: true, result: null }),
      'an answer it could not read',
    ],
  ])('%s is refused with what Cloudflare said', async (_, answer, detail) => {
    const error = await flipTest(
      Cloudflare.use((cloudflare) => cloudflare.createTunnel('n', HOST, LOCAL)),
      { upstream: answerWith(answer) }
    );
    expect(error._tag).toBe('CloudflareFailed');
    expect(error.message).toBe(`Cloudflare refused POST /accounts/account-1/cfd_tunnel: ${detail}.`);
  });

  test('Cloudflare out of reach is refused as unreachable', async () => {
    const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const error = await flipTest(
      Cloudflare.use((cloudflare) => cloudflare.updateIngress('t', HOST, LOCAL)),
      { upstream: { ...createUpstream(), fetch: unreachable } }
    );
    expect(error.message).toBe(
      'Cloudflare refused PUT /accounts/account-1/cfd_tunnel/t/configurations: unreachable.'
    );
  });
});

describe('removing a tunnel', () => {
  test('removes its DNS record then the tunnel, looking the zone up once per Worker', async () => {
    const upstream = createUpstream();
    await runTest(
      Cloudflare.use((cloudflare) =>
        Effect.andThen(cloudflare.removeTunnel('t1', 'r1'), cloudflare.removeTunnel('t2', 'r2'))
      ),
      { upstream }
    );
    expect(listCalls(upstream)).toEqual([
      'GET /client/v4/zones?name=shinsa.dev',
      'DELETE /client/v4/zones/zone-1/dns_records/r1',
      'DELETE /client/v4/accounts/account-1/cfd_tunnel/t1?cascade=true',
      'DELETE /client/v4/zones/zone-1/dns_records/r2',
      'DELETE /client/v4/accounts/account-1/cfd_tunnel/t2?cascade=true',
    ]);
  });

  test('refuses when the tunnel zone does not exist', async () => {
    const upstream = answerWith((_, path) =>
      path === '/client/v4/zones' ? Response.json({ success: true, result: [] }) : null
    );
    const error = await flipTest(
      Cloudflare.use((cloudflare) => cloudflare.removeTunnel('t', 'r')),
      { upstream }
    );
    expect(error.message).toBe('No Cloudflare zone named shinsa.dev.');
  });
});
