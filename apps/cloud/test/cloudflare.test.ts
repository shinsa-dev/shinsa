import { describe, expect, spyOn, test } from 'bun:test';
import { createCloudflare } from '../src/cloudflare.ts';
import { TEST_CONFIG } from './harness.ts';

function createApi(answer: (method: string, path: string) => Response) {
  const calls: string[] = [];
  const cloudflare = createCloudflare(TEST_CONFIG, (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);
    return Promise.resolve(answer(method, path));
  });
  return { calls, cloudflare };
}

describe('the Cloudflare API client', () => {
  test('says what Cloudflare answered when it is not JSON', async () => {
    const { cloudflare } = createApi(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(cloudflare.updateIngress('t', 'h', 'http://127.0.0.1:1')).rejects.toThrow('status 502');
  });

  test('refuses when the tunnel zone does not exist, and looks the zone up once', async () => {
    const { cloudflare } = createApi(() => Response.json({ success: true, result: [] }));
    await expect(cloudflare.removeTunnel('t', 'r')).rejects.toThrow('No Cloudflare zone named shinsa.dev');
    const found = createApi((_method, path) =>
      Response.json({ success: true, result: path === '/client/v4/zones' ? [{ id: 'z' }] : {} })
    );
    await found.cloudflare.removeTunnel('t', 'r');
    await found.cloudflare.removeTunnel('t', 'r');
    expect(found.calls.filter((call) => call === 'GET /client/v4/zones')).toHaveLength(1);
  });

  test('keeps the first failure when cleaning up a half-made tunnel fails too', async () => {
    const warned = spyOn(console, 'error').mockImplementation(() => undefined);
    const { cloudflare } = createApi((method, path) => {
      if (method === 'POST' && path.endsWith('/cfd_tunnel'))
        return Response.json({ success: true, result: { id: 'x' } });
      return Response.json({ success: false, errors: [{ message: 'denied' }] }, { status: 403 });
    });
    await expect(cloudflare.createTunnel('n', 'h', 'http://127.0.0.1:1')).rejects.toThrow('PUT');
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  });
});
