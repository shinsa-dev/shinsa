import { describe, expect, test } from 'bun:test';
import { isTunnelRequest, resolveChannelOriginRefusal, resolveTunnelRoute } from '../../src/remote/guard.ts';

function request(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(`http://127.0.0.1:7446${path}`, init);
}

describe('the tunnel guard', () => {
  test('treats anything cloudflared forwarded, or on the tunnel host, as from the tunnel', () => {
    expect(isTunnelRequest(request('/', { headers: { 'cf-connecting-ip': '1.2.3.4' } }), null)).toBe(true);
    expect(
      isTunnelRequest(request('/', { headers: { host: 'T-K3X9.shinsa.dev:443' } }), 't-k3x9.shinsa.dev')
    ).toBe(true);
    expect(isTunnelRequest(request('/'), 't-k3x9.shinsa.dev')).toBe(false);
    expect(isTunnelRequest(request('/'), null)).toBe(false);
  });

  test('lets through only health, webhooks and the channel', () => {
    const route = (path: string, method = 'GET') =>
      resolveTunnelRoute(request(path, { method }), new URL(`http://x${path}`));
    expect(route('/health')).toBe('health');
    expect(route('/api/hooks/s/t', 'POST')).toBe('hook');
    expect(route('/remote')).toBe('channel');
    expect(route('/remote', 'POST')).toBeNull();
    expect(route('/health', 'POST')).toBeNull();
    expect(route('/api/tasks')).toBeNull();
    expect(route('/ws')).toBeNull();
    expect(route('/')).toBeNull();
  });

  test('opens the channel only from app.shinsa.dev', () => {
    expect(
      resolveChannelOriginRefusal(request('/remote', { headers: { origin: 'https://app.shinsa.dev' } }))
    ).toBeNull();
    expect(
      resolveChannelOriginRefusal(request('/remote', { headers: { origin: 'https://evil.dev' } }))
    ).toContain('app.shinsa.dev');
    expect(resolveChannelOriginRefusal(request('/remote'))).not.toBeNull();
  });
});
