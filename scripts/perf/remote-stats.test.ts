import { describe, expect, it } from 'bun:test';
import {
  parseQuickTunnelUrl,
  type RouteSamples,
  serializeRemoteTable,
  summarizeCloud,
  summarizeRoute,
} from './remote-stats.ts';

const SAMPLES: RouteSamples = {
  label: 'Loopback',
  health: [2, 1, 3],
  connects: [
    { socketOpen: 4, handshake: 10, firstState: 900, stateFrameBytes: 23_000_000, stateBytes: 22_999_000 },
    { socketOpen: 2, handshake: 8, firstState: 700, stateFrameBytes: 2_500_000, stateBytes: 22_999_000 },
  ],
  requests: { '/api/health': [3, 5, 4] },
  parallel: [12, 14],
};

describe('parseQuickTunnelUrl', () => {
  it('reads the URL cloudflared prints for a quick tunnel', () => {
    expect(
      parseQuickTunnelUrl('INF |  https://silly-words-here-42.trycloudflare.com                    |')
    ).toBe('https://silly-words-here-42.trycloudflare.com');
  });

  it('returns null for any other line', () => {
    expect(parseQuickTunnelUrl('INF Registered tunnel connection connIndex=0')).toBeNull();
  });
});

describe('summarizeRoute', () => {
  it('summarizes each leg and keeps the last connect’s frame sizes', () => {
    const route = summarizeRoute(SAMPLES);
    expect(route.handshake.median).toBe(8);
    expect(route.firstState.max).toBe(900);
    expect(route.stateFrameBytes).toBe(2_500_000);
    expect(route.requests['/api/health']?.median).toBe(4);
    expect(route.parallel.count).toBe(2);
  });

  it('reads no sizes when nothing connected', () => {
    const route = summarizeRoute({ ...SAMPLES, connects: [] });
    expect(route.stateFrameBytes).toBe(0);
    expect(route.stateBytes).toBe(0);
  });
});

describe('summarizeCloud', () => {
  it('keeps the first call apart from the warm ones', () => {
    expect(summarizeCloud([120, 40, 60, 50])).toEqual({
      first: 120,
      warm: { count: 3, median: 50, p95: 60, min: 40, max: 60 },
    });
  });

  it('returns null without calls', () => {
    expect(summarizeCloud([])).toBeNull();
  });
});

describe('serializeRemoteTable', () => {
  it('writes one row per leg', () => {
    const table = serializeRemoteTable({
      cloud: summarizeCloud([120, 40]),
      tunnels: [{ label: 'Tunnel (quic)', registered: 1500, reachable: 4200 }],
      routes: [summarizeRoute(SAMPLES)],
    });
    expect(table).toContain('| Shinsa Cloud | Connect call, first (DNS, TLS) | 120 ms |');
    expect(table).toContain('| Tunnel (quic) | Quick tunnel name resolving (DNS) | 4200 ms |');
    expect(table).toContain('| Loopback | First state frame on the wire | 2.50 MB |');
    expect(table).toContain('| Loopback | `GET /api/health` through the channel | 4.0 ms (p95 5.0 ms) |');
  });

  it('leaves the cloud rows out when it was not called', () => {
    const table = serializeRemoteTable({ cloud: null, tunnels: [], routes: [] });
    expect(table).not.toContain('Shinsa Cloud');
  });
});
