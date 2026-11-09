import { describe, expect, test } from 'bun:test';
import type { HeartbeatResponse, MachineCredentials, RemoteAccess, TunnelStatus } from '@shinsa/core';
import { Revoked } from '@shinsa/core/remote/errors';
import { Clock, Deferred, type Duration, Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { JsonLogger } from '../../src/log/service.ts';
import { RemoteUnreachable } from '../../src/remote/client/schema.ts';
import { RemoteClient } from '../../src/remote/client/service.ts';
import { TunnelConnectFailed } from '../../src/remote/connector/schema.ts';
import { TunnelConnector } from '../../src/remote/connector/service.ts';
import { TunnelHealth } from '../../src/remote/health/service.ts';
import { RESTART_SCHEDULE, TunnelMachine } from '../../src/remote/tunnel/schema.ts';
import { TunnelSupervisor } from '../../src/remote/tunnel/service.ts';
import { captureLogs } from '../helpers/index.ts';

const CREDENTIALS: MachineCredentials = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: 'AAAA',
};

const ACCESS: RemoteAccess = {
  owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
  members: [{ user: { id: '7', login: 'kai', name: null, avatarUrl: null }, addedAt: 3 }],
};

const ANSWER = { ok: true, ...ACCESS } as HeartbeatResponse;

type HeartbeatAnswer = ReturnType<TunnelMachine['Service']['heartbeat']>;

interface FakeConnector {
  stopped: boolean;
  exit: Deferred.Deferred<void>;
}

interface WorldOptions {
  heartbeat?: (call: number) => HeartbeatAnswer;
  healthy?: () => boolean;
  offline?: () => Response;
  signingKey?: string;
  connectDelay?: Duration.Input;
  failConnects?: number;
}

function createWorld(options: WorldOptions = {}) {
  const connectors: FakeConnector[] = [];
  const attempts: number[] = [];
  const heartbeats: unknown[] = [];
  const offline: string[] = [];
  const statuses: TunnelStatus[] = [];
  const accesses: RemoteAccess[] = [];
  const forgotten: number[] = [];
  let failConnects = options.failConnects ?? 0;
  const connector = Layer.succeed(TunnelConnector, {
    open: (token, localUrl) =>
      Effect.gen(function* () {
        expect([Redacted.value(token), localUrl]).toEqual(['tunnel', 'http://127.0.0.1:7446']);
        attempts.push(yield* Clock.currentTimeMillis);
        if (failConnects > 0) {
          failConnects -= 1;
          return yield* new TunnelConnectFailed({ message: 'no network' });
        }
        const fake: FakeConnector = { stopped: false, exit: yield* Deferred.make<void>() };
        connectors.push(fake);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            fake.stopped = true;
          })
        );
        if (options.connectDelay) yield* Effect.sleep(options.connectDelay);
        return { exited: Deferred.await(fake.exit) };
      }),
  });
  const machine = Layer.succeed(TunnelMachine, {
    version: '1.0.0',
    localUrl: Effect.succeed('http://127.0.0.1:7446'),
    signingKey: Effect.succeed(options.signingKey ?? null),
    heartbeat: (token, request) => {
      heartbeats.push({ token: Redacted.value(token), request });
      return options.heartbeat ? options.heartbeat(heartbeats.length) : Effect.succeed(ANSWER);
    },
    recordAccess: (access) => Effect.sync(() => accesses.push(access)),
    recordTeams: () => Effect.void,
    recordStatus: (status) => Effect.sync(() => statuses.push(status)),
    forget: Effect.sync(() => forgotten.push(1)),
  });
  const health = Layer.succeed(TunnelHealth, {
    check: () => Effect.sync(() => (options.healthy ? options.healthy() : true)),
  });
  const fetch = ((_input: string, init?: RequestInit) => {
    offline.push(new Headers(init?.headers).get('authorization') ?? '');
    return Promise.resolve(options.offline ? options.offline() : Response.json({ ok: true }));
  }) as typeof globalThis.fetch;
  const client = RemoteClient.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  const layer = TunnelSupervisor.layer.pipe(
    Layer.provide(Layer.mergeAll(machine, connector, health, client)),
    Layer.provideMerge(JsonLogger)
  );
  return { layer, connectors, attempts, heartbeats, offline, statuses, accesses, forgotten };
}

type World = ReturnType<typeof createWorld>;

function run(world: World, body: (supervisor: TunnelSupervisor['Service']) => Effect.Effect<void>) {
  return Effect.runPromise(
    TunnelSupervisor.use(body).pipe(
      Effect.provide(world.layer),
      Effect.scoped,
      Effect.provide(TestClock.layer())
    )
  );
}

const PING = '30 seconds';

describe('the restart schedule', () => {
  test('retries every second for the first minute, then after 2, 4, 10 and 30 seconds, and stays at 30', async () => {
    const times = await Effect.runPromise(
      Effect.gen(function* () {
        const seen: number[] = [];
        const fiber = yield* Effect.gen(function* () {
          seen.push(yield* Clock.currentTimeMillis);
          return yield* Effect.fail('down');
        }).pipe(Effect.retry(RESTART_SCHEDULE), Effect.forkChild);
        for (let step = 0; step < 200; step += 1) yield* TestClock.adjust('1 second');
        yield* Fiber.interrupt(fiber);
        return seen;
      }).pipe(Effect.provide(TestClock.layer()))
    );
    const delays = times.slice(1).map((time, index) => time - (times[index] ?? 0));
    const quick = delays.filter((delay) => delay === 1_000).length;
    expect(quick).toBe(61);
    expect(delays.slice(quick, quick + 6)).toEqual([2_000, 4_000, 10_000, 30_000, 30_000, 30_000]);
  });
});

describe('the tunnel supervisor', () => {
  test('sends the machine’s signing key with every heartbeat', async () => {
    const world = createWorld({ signingKey: 'signing-key' });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(world.heartbeats[0]).toEqual({
          token: 'machine',
          request: {
            localUrl: 'http://127.0.0.1:7446',
            version: '1.0.0',
            features: ['bound-connect-tokens', 'sealed-pairing', 'slack-linked-threads', 'slack-task-owner'],
            signingKey: 'signing-key',
          },
        });
        yield* supervisor.stop;
      })
    );
  });

  test('connects, heartbeats with the local URL, pings and heartbeats again every fourth ping', async () => {
    const world = createWorld();
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(yield* supervisor.status).toBe('connected');
        expect(world.statuses).toEqual(['starting', 'connected']);
        expect(world.heartbeats[0]).toEqual({
          token: 'machine',
          request: {
            localUrl: 'http://127.0.0.1:7446',
            version: '1.0.0',
            features: ['bound-connect-tokens', 'sealed-pairing', 'slack-linked-threads', 'slack-task-owner'],
          },
        });
        for (let ping = 0; ping < 3; ping += 1) yield* TestClock.adjust(PING);
        expect(world.heartbeats).toHaveLength(1);
        yield* TestClock.adjust(PING);
        expect(world.heartbeats).toHaveLength(2);
        yield* supervisor.stop;
        expect(world.connectors[0]?.stopped).toBe(true);
        expect(world.offline).toEqual(['Bearer machine']);
        expect(yield* supervisor.status).toBe('off');
        yield* supervisor.stop;
        expect(world.offline).toEqual(['Bearer machine']);
      })
    );
  });

  test('hands on who has access from every heartbeat, and heartbeats on request', async () => {
    const world = createWorld();
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.heartbeat;
        expect(world.heartbeats).toEqual([]);
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(world.accesses[0]).toEqual(ACCESS);
        yield* supervisor.heartbeat;
        expect(world.heartbeats).toHaveLength(2);
        yield* supervisor.stop;
      })
    );
  });

  test('passes nothing on from a heartbeat answer that names no owner', async () => {
    const world = createWorld({ heartbeat: () => Effect.succeed({ ok: true } as HeartbeatResponse) });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        yield* supervisor.heartbeat;
        expect(world.heartbeats).toHaveLength(2);
        expect(world.accesses).toEqual([]);
        yield* supervisor.stop;
      })
    );
  });

  test('restarts the connector after three failed pings, and when cloudflared exits', async () => {
    let healthy = false;
    const world = createWorld({ healthy: () => healthy });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        yield* TestClock.adjust(PING);
        yield* TestClock.adjust(PING);
        expect(world.connectors).toHaveLength(1);
        yield* TestClock.adjust(PING);
        expect(world.connectors[0]?.stopped).toBe(true);
        expect(yield* supervisor.status).toBe('reconnecting');
        yield* TestClock.adjust('1 second');
        expect(world.connectors).toHaveLength(2);
        expect(yield* supervisor.status).toBe('connected');
        healthy = true;
        yield* TestClock.adjust(PING);
        const current = world.connectors.at(-1) as FakeConnector;
        yield* Deferred.succeed(current.exit, undefined);
        yield* TestClock.adjust(0);
        expect(yield* supervisor.status).toBe('reconnecting');
        const restartedAt = world.attempts.length;
        yield* TestClock.adjust('1 second');
        expect(world.attempts).toHaveLength(restartedAt + 1);
        expect(world.connectors.at(-1)).not.toBe(current);
        yield* supervisor.stop;
      })
    );
    expect(world.statuses).toContain('reconnecting');
  });

  test('retries a connect that failed, and logs a heartbeat that failed without stopping', async () => {
    const logs = captureLogs();
    const world = createWorld({
      failConnects: 2,
      heartbeat: (call) =>
        call === 1
          ? Effect.fail(
              new RemoteUnreachable({
                endpoint: 'machine.heartbeat',
                status: 503,
                retryable: true,
                message: 'Down.',
              })
            )
          : Effect.succeed(ANSWER),
    });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(world.attempts).toHaveLength(1);
        yield* TestClock.adjust('1 second');
        yield* TestClock.adjust('1 second');
        expect(world.attempts).toEqual([0, 1_000, 2_000]);
        expect(yield* supervisor.status).toBe('connected');
        expect(world.connectors).toHaveLength(1);
        yield* supervisor.stop;
      })
    );
    logs.restore();
    expect(logs.fieldsOf('[Remote] The tunnel did not connect')).toEqual([
      { error: 'no network' },
      { error: 'no network' },
    ]);
    expect(logs.fieldsOf('[Remote] The heartbeat failed')).toHaveLength(1);
  });

  test('stops for good and reports it when the control plane revokes the machine', async () => {
    const logs = captureLogs();
    const world = createWorld({ heartbeat: () => Effect.fail(new Revoked({ message: 'Removed.' })) });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(world.forgotten).toEqual([1]);
        expect(yield* supervisor.status).toBe('revoked');
        expect(world.connectors[0]?.stopped).toBe(true);
        yield* supervisor.heartbeat;
        expect(world.heartbeats).toHaveLength(1);
        yield* supervisor.stop;
        expect(world.offline).toEqual([]);
      })
    );
    logs.restore();
    expect(logs.fieldsOf('[Remote] Shinsa Cloud removed this machine; remote access is off')).toHaveLength(1);
  });

  test('revokes on a later heartbeat too, and on one asked for', async () => {
    const logs = captureLogs();
    const revokeFrom = { call: 3 };
    const world = createWorld({
      heartbeat: (call) =>
        call >= revokeFrom.call ? Effect.fail(new Revoked({ message: 'Removed.' })) : Effect.succeed(ANSWER),
    });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        for (let ping = 0; ping < 4; ping += 1) yield* TestClock.adjust(PING);
        expect(yield* supervisor.status).toBe('connected');
        for (let ping = 0; ping < 4; ping += 1) yield* TestClock.adjust(PING);
        expect(yield* supervisor.status).toBe('revoked');
        expect(world.forgotten).toEqual([1]);
        revokeFrom.call = 1;
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        expect(world.forgotten).toEqual([1, 1]);
      })
    );
    logs.restore();
  });

  test('revokes when a heartbeat asked for is refused', async () => {
    const logs = captureLogs();
    let refuse = false;
    const world = createWorld({
      heartbeat: () => (refuse ? Effect.fail(new Revoked({ message: 'Removed.' })) : Effect.succeed(ANSWER)),
    });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust(0);
        refuse = true;
        yield* supervisor.heartbeat;
        expect(yield* supervisor.status).toBe('revoked');
        expect(world.connectors[0]?.stopped).toBe(true);
        expect(world.forgotten).toEqual([1]);
      })
    );
    logs.restore();
  });

  test('keeps going when marking offline fails, and stops a connector still opening when it stops', async () => {
    const logs = captureLogs();
    const world = createWorld({
      connectDelay: '5 seconds',
      offline: () => Response.json({ error: { code: 'server_error', message: 'Down.' } }, { status: 500 }),
    });
    await run(world, (supervisor) =>
      Effect.gen(function* () {
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust('1 second');
        expect(world.connectors).toHaveLength(1);
        yield* supervisor.stop;
        expect(world.connectors[0]?.stopped).toBe(true);
        expect(world.heartbeats).toEqual([]);
        yield* supervisor.start(CREDENTIALS);
        yield* TestClock.adjust('5 seconds');
        expect(yield* supervisor.status).toBe('connected');
        yield* supervisor.stop;
      })
    );
    logs.restore();
    expect(logs.fieldsOf('[Remote] Could not mark this machine offline')).toHaveLength(2);
  });
});
