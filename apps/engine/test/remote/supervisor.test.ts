import { describe, expect, spyOn, test } from 'bun:test';
import type { HeartbeatResponse, MachineCredentials, RemoteAccess } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { RevokedError } from '../../src/remote/control.ts';
import {
  resolveRestartDelay,
  TUNNEL_TIMINGS,
  type TunnelConnector,
  type TunnelStatus,
  TunnelSupervisor,
  type TunnelTimings,
} from '../../src/remote/supervisor.ts';

const CREDENTIALS: MachineCredentials = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: 'AAAA',
};

const FAST: TunnelTimings = {
  pingMs: 2,
  heartbeatEvery: 2,
  failedPingsBeforeRestart: 2,
  quickRetryWindowMs: 60_000,
  quickRetryMs: 2,
  backoffMs: [2],
};

const ACCESS: RemoteAccess = {
  owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
  members: [{ user: { id: '7', login: 'kai', name: null, avatarUrl: null }, addedAt: 3 }],
};

const ANSWER = { ok: true, ...ACCESS } as HeartbeatResponse;

interface FakeConnector extends TunnelConnector {
  exit: () => void;
  stopped: boolean;
}

function createWorld(
  options: {
    heartbeat?: () => Promise<HeartbeatResponse>;
    ping?: () => boolean;
    offline?: () => Promise<void>;
    signingKey?: () => Promise<string>;
  } = {}
) {
  const connectors: FakeConnector[] = [];
  const heartbeats: unknown[] = [];
  const offline: string[] = [];
  const statuses: TunnelStatus[] = [];
  const revoked: number[] = [];
  const accesses: RemoteAccess[] = [];
  const failConnects = { count: 0 };
  const supervisor = new TunnelSupervisor({
    control: {
      recordHeartbeat: (token, request) => {
        heartbeats.push({ token, request });
        return options.heartbeat ? options.heartbeat() : Promise.resolve(ANSWER);
      },
      recordOffline: (token) => {
        offline.push(token);
        return options.offline ? options.offline() : Promise.resolve();
      },
    },
    connect: (token, localUrl) => {
      if (failConnects.count > 0) {
        failConnects.count -= 1;
        return Promise.reject(new Error('no network'));
      }
      let exit: () => void = () => undefined;
      const connector: FakeConnector = {
        exited: new Promise<void>((resolve) => {
          exit = resolve;
        }),
        stop: () => {
          connector.stopped = true;
        },
        exit: () => exit(),
        stopped: false,
      };
      expect([token, localUrl]).toEqual(['tunnel', 'http://127.0.0.1:7446']);
      connectors.push(connector);
      return Promise.resolve(connector);
    },
    ping: () => {
      const healthy = options.ping ? options.ping() : true;
      return healthy ? Promise.resolve(true) : Promise.reject(new Error('unreachable'));
    },
    localUrl: () => 'http://127.0.0.1:7446',
    version: '1.0.0',
    ...(options.signingKey ? { signingKey: options.signingKey } : {}),
    onRevoked: () => revoked.push(1),
    onAccess: (access) => accesses.push(access),
    timings: FAST,
  });
  supervisor.subscribe((status) => statuses.push(status));
  return { supervisor, connectors, heartbeats, offline, statuses, revoked, failConnects, accesses };
}

async function until(condition: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(1);
  }
}

describe('the restart delay', () => {
  test('retries every second for the first minute, then backs off and stays at the longest', () => {
    expect(resolveRestartDelay(TUNNEL_TIMINGS, 0, 0)).toBe(1_000);
    expect(resolveRestartDelay(TUNNEL_TIMINGS, 59_999, 0)).toBe(1_000);
    expect([0, 1, 2, 3, 9].map((attempt) => resolveRestartDelay(TUNNEL_TIMINGS, 60_000, attempt))).toEqual([
      2_000, 4_000, 10_000, 30_000, 30_000,
    ]);
    expect(resolveRestartDelay({ ...TUNNEL_TIMINGS, backoffMs: [] }, 60_000, 0)).toBe(1_000);
  });
});

describe('the tunnel supervisor', () => {
  test('sends the machine’s signing key with every heartbeat', async () => {
    const world = createWorld({ signingKey: () => Promise.resolve('signing-key') });
    world.supervisor.start(CREDENTIALS);
    await until(() => world.heartbeats.length > 0);
    expect(world.heartbeats[0]).toEqual({
      token: 'machine',
      request: { localUrl: 'http://127.0.0.1:7446', version: '1.0.0', signingKey: 'signing-key' },
    });
    await world.supervisor.stop();
  });

  test('connects, heartbeats with the local URL, pings and heartbeats again every few pings', async () => {
    const world = createWorld();
    world.supervisor.start(CREDENTIALS);
    await until(() => world.heartbeats.length >= 2);
    expect(world.supervisor.status).toBe('connected');
    expect(world.statuses.slice(0, 2)).toEqual(['starting', 'connected']);
    expect(world.heartbeats[0]).toEqual({
      token: 'machine',
      request: { localUrl: 'http://127.0.0.1:7446', version: '1.0.0' },
    });
    await world.supervisor.stop();
    expect(world.connectors[0]?.stopped).toBe(true);
    expect(world.offline).toEqual(['machine']);
    expect(world.supervisor.status).toBe('off');
    await world.supervisor.stop();
    expect(world.offline).toEqual(['machine']);
    const seen: TunnelStatus[] = [];
    const unsubscribe = world.supervisor.subscribe((status) => seen.push(status));
    unsubscribe();
    world.supervisor.start(CREDENTIALS);
    await world.supervisor.stop();
    expect(seen).toEqual([]);
  });

  test('hands on who has access from every heartbeat, and heartbeats on request', async () => {
    const world = createWorld();
    world.supervisor.start(CREDENTIALS);
    await until(() => world.accesses.length > 0);
    expect(world.accesses[0]).toEqual(ACCESS);
    const before = world.heartbeats.length;
    await world.supervisor.requestHeartbeat();
    expect(world.heartbeats.length).toBeGreaterThan(before);
    await world.supervisor.stop();
  });

  test('passes nothing on from a heartbeat answer that names no owner', async () => {
    const world = createWorld({ heartbeat: () => Promise.resolve({ ok: true } as HeartbeatResponse) });
    world.supervisor.start(CREDENTIALS);
    await until(() => world.heartbeats.length >= 2);
    expect(world.accesses).toEqual([]);
    await world.supervisor.stop();
  });

  test('restarts the connector after failed pings, and when cloudflared exits', async () => {
    let healthy = false;
    const world = createWorld({ ping: () => healthy });
    world.supervisor.start(CREDENTIALS);
    await until(() => world.connectors.length >= 2);
    expect(world.connectors[0]?.stopped).toBe(true);
    expect(world.statuses).toContain('reconnecting');
    healthy = true;
    await until(() => world.supervisor.status === 'connected');
    const current = world.connectors.at(-1) as FakeConnector;
    current.exit();
    await until(() => world.connectors.at(-1) !== current);
    await world.supervisor.stop();
  });

  test('retries a connect that failed, and logs a heartbeat that failed without stopping', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    let failHeartbeat = true;
    const world = createWorld({
      heartbeat: () => (failHeartbeat ? Promise.reject(new Error('down')) : Promise.resolve(ANSWER)),
    });
    world.failConnects.count = 2;
    world.supervisor.start(CREDENTIALS);
    await until(() => world.supervisor.status === 'connected');
    expect(world.connectors).toHaveLength(1);
    failHeartbeat = false;
    await world.supervisor.stop();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('stops for good and reports it when the control plane revokes the machine', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const world = createWorld({ heartbeat: () => Promise.reject(new RevokedError()) });
    world.supervisor.start(CREDENTIALS);
    await until(() => world.revoked.length === 1);
    expect(world.supervisor.status).toBe('revoked');
    expect(world.connectors[0]?.stopped).toBe(true);
    await world.supervisor.stop();
    expect(world.offline).toEqual([]);
    warn.mockRestore();
  });

  test('revokes on a later heartbeat too', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const world = createWorld({
      heartbeat: () => {
        calls += 1;
        return calls > 1 ? Promise.reject(new RevokedError()) : Promise.resolve(ANSWER);
      },
    });
    world.supervisor.start(CREDENTIALS);
    await until(() => world.revoked.length === 1);
    expect(world.supervisor.status).toBe('revoked');
    warn.mockRestore();
  });

  test('keeps going when marking offline fails, and drops a connector that arrives after a stop', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const world = createWorld({ offline: () => Promise.reject(new Error('down')) });
    world.supervisor.start(CREDENTIALS);
    await world.supervisor.stop();
    await until(() => world.connectors.length === 1);
    expect(world.connectors[0]?.stopped).toBe(true);
    world.supervisor.start(CREDENTIALS);
    await until(() => world.supervisor.status === 'connected');
    await world.supervisor.stop();
    expect(warn).toHaveBeenCalledWith('[Remote] Could not mark this machine offline', expect.anything());
    warn.mockRestore();
  });

  test('backs off once a failure streak passes the quick-retry window', async () => {
    let now = 0;
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const attempts: number[] = [];
    const supervisor = new TunnelSupervisor({
      control: { recordHeartbeat: () => Promise.resolve(ANSWER), recordOffline: () => Promise.resolve() },
      connect: () => {
        attempts.push(now);
        now += 30_000;
        return Promise.reject(new Error('down'));
      },
      ping: () => Promise.resolve(true),
      localUrl: () => 'http://127.0.0.1:1',
      version: '1',
      onRevoked: () => undefined,
      timings: { ...FAST, quickRetryWindowMs: 50_000 },
      now: () => now,
    });
    supervisor.start(CREDENTIALS);
    await until(() => attempts.length >= 4);
    await supervisor.stop();
    warn.mockRestore();
  });
});
