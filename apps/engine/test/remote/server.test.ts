import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentModel,
  type Bytes,
  type ChannelMessage,
  CONNECT_TOKEN_TTL_MS,
  createConnectToken,
  parseEnrollFragment,
  REMOTE_APP_ORIGIN,
  REMOTE_PATHS,
  serializeBase64Url,
} from '@shinsa/core';
import { type ModelSource, Transcripts } from '../../src/agents/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { startServer } from '../../src/http/index.ts';
import { log } from '../../src/log/index.ts';
import {
  ControlClient,
  createUrlOpener,
  openRemoteUrl,
  Remote,
  type RemoteSnapshot,
  requestHealth,
  resolveMachineName,
  resolveRequestOrigin,
} from '../../src/remote/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import type { Schedules } from '../../src/schedules/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, createTestOnboarding, until } from '../helpers/index.ts';
import { createKeyPair, startHandshake, type TestSession } from './client.ts';
import { startFakeControlPlane } from './control-plane.ts';

const CONNECT_KEY = serializeBase64Url(new Uint8Array(32).fill(9));

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: CONNECT_KEY,
};

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

function createModels(models: AgentModel[]) {
  return { listModels: () => Promise.resolve(models) } as unknown as ModelSource;
}

function createFakeSchedules() {
  return {
    isWebhook: (path: string) => path.startsWith('/api/hooks/'),
    handleWebhook: () => Promise.resolve(new Response('hooked', { status: 202 })),
    routes: () => [],
  } as unknown as Schedules;
}

async function start(
  options: {
    enabled?: boolean;
    paired?: boolean;
    config?: Partial<ServerConfig>;
    openUrl?: (url: string) => Promise<void>;
  } = {}
) {
  const config = createTestConfig(createTempDir(), options.config);
  const plane = startFakeControlPlane();
  running.push(plane.stop);
  const path = join(config.dataDir, 'remote.json');
  if (options.paired ?? true)
    writeFileSync(
      path,
      JSON.stringify({ credentials: CREDENTIALS, enabled: options.enabled ?? true, owner: 'mona' })
    );
  const opened: string[] = [];
  const connectors: { stopped: boolean }[] = [];
  const remote = new Remote({
    path,
    control: new ControlClient({ origin: plane.origin }),
    connect: () => {
      const connector = { stopped: false, exited: new Promise(() => undefined), stop: () => undefined };
      connector.stop = () => {
        connector.stopped = true;
      };
      connectors.push(connector);
      return Promise.resolve(connector);
    },
    ping: () => Promise.resolve(true),
    localUrl: () => 'http://127.0.0.1:1',
    version: '1',
    maxBodyBytes: 1024 * 1024,
    machineName: 'Studio',
    openUrl:
      options.openUrl ??
      ((url) => {
        opened.push(url);
        return Promise.resolve();
      }),
    pairPollMs: 1,
  });
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: createModels([]),
    onboarding: createTestOnboarding(engine, config).onboarding,
    schedules: createFakeSchedules(),
    remote,
  });
  running.push(async () => {
    await remote.stop();
    await http.stop();
  });
  const base = `http://127.0.0.1:${http.server.port}`;
  const tunnel = (route: string, init: RequestInit = {}) =>
    fetch(`${base}${route}`, { ...init, headers: { 'cf-connecting-ip': '203.0.113.9', ...init.headers } });
  const local = (route: string, body?: unknown) =>
    fetch(`${base}${route}`, {
      ...(body === undefined
        ? {}
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  return { remote, base, tunnel, local, port: http.server.port, plane, connectors, opened };
}

async function createToken(expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS) {
  return createConnectToken(CONNECT_KEY, { instanceId: 'k3x9', userId: '1', expiresAt });
}

interface OpenChannel {
  session: TestSession;
  next: () => Promise<ChannelMessage>;
  send: (message: ChannelMessage) => Promise<void>;
  socket: WebSocket;
  closed: Promise<number>;
}

async function openChannel(
  origin: string,
  port: number | undefined,
  enrollSecret: string,
  machineKey: string
): Promise<OpenChannel> {
  const token = await createToken();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/remote?token=${encodeURIComponent(token)}`, {
    headers: { origin, 'cf-connecting-ip': '203.0.113.9' },
  } as unknown as string[]);
  socket.binaryType = 'arraybuffer';
  const inbox: (string | Bytes)[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener('message', (event) => {
    inbox.push(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer));
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener('close', (event) => resolve(event.code))
  );
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const take = async () => {
    while (inbox.length === 0) await new Promise<void>((resolve) => waiters.push(resolve));
    return inbox.shift() as string | Bytes;
  };
  const handshake = await startHandshake({ machineKey, device: await createKeyPair(), enrollSecret });
  socket.send(handshake.hello);
  const session = await handshake.finish((await take()) as string);
  const next = async () => {
    for (;;) {
      const message = await session.open((await take()) as Bytes);
      if (message) return message;
    }
  };
  return {
    session,
    next,
    send: async (message) => socket.send(await session.seal(message)),
    socket,
    closed,
  };
}

async function readAck(channel: OpenChannel) {
  for (;;) {
    const message = await channel.next();
    if (message.t !== 'socket') continue;
    const parsed = JSON.parse(message.data) as { type: string; error: { code: string } | null };
    if (parsed.type === 'ack') return parsed;
  }
}

describe('the tunnel entry point', () => {
  test('answers only health, webhooks and the channel, and 404s the rest of the app', async () => {
    const { tunnel } = await start();
    expect((await tunnel('/health')).status).toBe(200);
    expect(await (await tunnel('/api/hooks/s/t', { method: 'POST', body: '{}' })).text()).toBe('hooked');
    for (const path of ['/api/tasks', '/api/health', '/ws', '/', '/api/hooks', '/api/extensions/callback']) {
      expect((await tunnel(path)).status).toBe(404);
    }
    expect((await tunnel('/api/commands', { method: 'POST', body: '{}' })).status).toBe(404);
  });

  test('answers nothing while remote access is off', async () => {
    const { tunnel, remote } = await start({ enabled: false });
    expect((await tunnel('/health')).status).toBe(404);
    expect((await tunnel('/remote', { headers: { origin: remote.appOrigin } })).status).toBe(404);
  });

  test('keeps webhooks read-only in inspect mode', async () => {
    const { tunnel } = await start({ config: { inspect: true } });
    expect((await tunnel('/api/hooks/s/t', { method: 'POST', body: '{}' })).status).toBe(403);
  });

  test('refuses the channel from another origin, without a token or with a bad one', async () => {
    const { tunnel, remote, plane } = await start();
    expect(remote.appOrigin).toBe(plane.origin);
    const origin = { origin: remote.appOrigin };
    expect((await tunnel('/remote', { headers: { origin: 'https://evil.dev' } })).status).toBe(403);
    const good = encodeURIComponent(await createToken());
    expect((await tunnel(`/remote?token=${good}`, { headers: { origin: REMOTE_APP_ORIGIN } })).status).toBe(
      403
    );
    expect((await tunnel('/remote', { headers: origin })).status).toBe(401);
    const expired = encodeURIComponent(await createToken(Date.now() - 1));
    expect((await tunnel(`/remote?token=${expired}`, { headers: origin })).status).toBe(401);
    expect((await tunnel(`/remote?token=${good}`, { headers: origin })).status).toBe(400);
  });

  test('never treats a tunnel request as local, whatever its Host says', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/health`, {
      headers: { host: 't-k3x9.shinsa.dev' },
    });
    expect(response.status).toBe(404);
  });
});

describe('the sealed channel over the tunnel', () => {
  test('enrolls a device, serves the app socket and the API inside it, and refuses local-only commands', async () => {
    const { remote, port } = await start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(
      remote.appOrigin,
      port,
      remote.enrollments.create('Phone').secret,
      machine.publicKey
    );
    expect(await channel.next()).toEqual({ t: 'ready' });
    expect(remote.snapshot().devices).toHaveLength(1);
    await channel.send({ t: 'ready' });
    expect(await channel.next()).toMatchObject({ t: 'socket' });
    await channel.send({
      t: 'socket',
      data: JSON.stringify({
        type: 'command',
        id: 'c1',
        command: { type: 'settings.change', patch: { mergeMethod: 'squash' } },
      }),
    });
    expect((await readAck(channel)).error?.code).toBe('local_only');
    await channel.send({
      t: 'socket',
      data: JSON.stringify({ type: 'command', id: 'c2', command: { type: 'not.a.command' } }),
    });
    expect((await readAck(channel)).error?.code).toBe('command_forbidden');
    await channel.send({ t: 'request', id: 'h', method: 'GET', path: '/api/health', headers: [] });
    await channel.send({ t: 'end', id: 'h' });
    await channel.send({ t: 'request', id: 'x', method: 'GET', path: '/index.html', headers: [] });
    await channel.send({ t: 'end', id: 'x' });
    const statuses = new Map<string, number>();
    while (statuses.size < 2) {
      const message = await channel.next();
      if (message.t === 'response') statuses.set(message.id, message.status);
    }
    expect(statuses).toEqual(
      new Map([
        ['h', 200],
        ['x', 404],
      ])
    );
    const device = remote.snapshot().devices[0]?.publicKey ?? '';
    expect(remote.removeDevice(device)).toBe(true);
    expect(await channel.closed).toBe(1008);
  });

  test('closes every channel when remote access stops', async () => {
    const { remote, port, connectors } = await start();
    remote.start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(
      remote.appOrigin,
      port,
      remote.enrollments.create('Phone').secret,
      machine.publicKey
    );
    expect(await channel.next()).toEqual({ t: 'ready' });
    await remote.stop();
    expect(await channel.closed).toBe(1008);
    expect(connectors[0]?.stopped).toBe(true);
  });

  test('closes a channel the browser closes without breaking the server', async () => {
    const { remote, port, tunnel } = await start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(
      remote.appOrigin,
      port,
      remote.enrollments.create('Phone').secret,
      machine.publicKey
    );
    expect(await channel.next()).toEqual({ t: 'ready' });
    channel.socket.close();
    await channel.closed;
    expect((await tunnel('/health')).status).toBe(200);
  });
});

describe('the remote service', () => {
  test('reports its state, starts only when enabled and forgets its credentials when revoked', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { remote, plane, connectors } = await start();
    const changes: number[] = [];
    const unsubscribe = remote.subscribe(() => changes.push(1));
    expect(remote.snapshot()).toMatchObject({
      paired: true,
      enabled: true,
      instanceId: 'k3x9',
      owner: 'mona',
    });
    expect(remote.tunnelHost).toBe('t-k3x9.shinsa.dev');
    expect(await remote.verifyConnect(null)).toBeNull();
    plane.answers.set('/app/__remote/machine/heartbeat', () => new Response('', { status: 401 }));
    remote.start();
    const deadline = performance.now() + 2_000;
    while (remote.snapshot().paired && performance.now() < deadline) await Bun.sleep(1);
    expect(remote.snapshot()).toMatchObject({ paired: false, enabled: false, status: 'revoked' });
    expect(connectors[0]?.stopped).toBe(true);
    expect(changes.length).toBeGreaterThan(0);
    unsubscribe();
    remote.start();
    expect(connectors).toHaveLength(1);
    expect(remote.tunnelHost).toBeNull();
    warn.mockRestore();
  });

  test('marks a request that came through the channel as remote', () => {
    expect(resolveRequestOrigin(new Request('http://x/'))).toBe('local');
  });
});

describe('the health ping', () => {
  test('is healthy only when the tunnel host answers 2xx', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => new Response('', { status: request.url.endsWith('/health') ? 200 : 503 }),
    });
    running.push(() => server.stop(true));
    expect(await requestHealth(`http://127.0.0.1:${server.port}/health`)).toBe(true);
    expect(await requestHealth(`http://127.0.0.1:${server.port}/down`)).toBe(false);
    expect(await requestHealth('http://127.0.0.1:1/health')).toBe(false);
  });
});

async function readSnapshot(response: Response) {
  return (await response.json()) as RemoteSnapshot;
}

async function readError(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('pairing this Mac', () => {
  test('starts with GitHub sign-in in the browser and starts the tunnel once the instance is claimed', async () => {
    const { remote, local, plane, opened, connectors } = await start({ paired: false });
    let polls = 0;
    plane.answers.set(REMOTE_PATHS.pairStart, () =>
      Response.json({
        claimCode: 'K7PQ',
        pollSecret: 'poll',
        url: 'https://shinsa.dev/app/pair?code=K7PQ',
        expiresAt: Date.now() + 60_000,
      })
    );
    plane.answers.set(REMOTE_PATHS.pairPoll, () => {
      polls += 1;
      if (polls < 3) return Response.json({ status: 'pending' });
      return Response.json({ status: 'claimed', credentials: CREDENTIALS, owner: 'mona' });
    });
    const started = await readSnapshot(await local('/api/remote/pair', {}));
    expect(started.pairing).toEqual({
      claimCode: 'K7PQ',
      url: 'https://shinsa.dev/app/pair?code=K7PQ',
      expiresAt: expect.any(Number),
    });
    expect(opened).toEqual(['https://shinsa.dev/app/pair?code=K7PQ']);
    const startCall = plane.calls.find((call) => call.path === REMOTE_PATHS.pairStart);
    expect(startCall?.body).toEqual({ name: 'Studio', publicKey: started.machineKey, version: '1' });
    expect((await readSnapshot(await local('/api/remote/pair', {}))).pairing?.claimCode).toBe('K7PQ');
    await until('paired', () => remote.snapshot().paired);
    expect(remote.snapshot()).toMatchObject({ paired: true, enabled: true, owner: 'mona', pairing: null });
    await until('tunnel started', () => connectors.length === 1);
    expect(await readError(await local('/api/remote/pair', {}))).toBe('remote_paired');
  });

  test('ends a pairing that expired or was cancelled without pairing, and survives a browser that will not open', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { remote, local, plane } = await start({
      paired: false,
      openUrl: () => Promise.reject(new Error('no browser')),
    });
    plane.answers.set(REMOTE_PATHS.pairStart, () =>
      Response.json({ claimCode: 'A', pollSecret: 'p', url: 'u', expiresAt: Date.now() + 60_000 })
    );
    plane.answers.set(REMOTE_PATHS.pairPoll, () => Response.json({ status: 'expired' }));
    await local('/api/remote/pair', {});
    await until('pairing ended', () => remote.snapshot().pairing === null);
    expect(remote.snapshot().paired).toBe(false);
    plane.answers.set(REMOTE_PATHS.pairPoll, () => Response.json({ status: 'pending' }));
    await local('/api/remote/pair', {});
    expect(remote.snapshot().pairing).not.toBeNull();
    await local('/api/remote/pair/cancel', {});
    await until('pairing ended', () => remote.snapshot().pairing === null);
    expect(warn).toHaveBeenCalledWith('[Remote] Could not open the pairing page', expect.anything());
    warn.mockRestore();
  });
});

describe('managing remote access on the Mac', () => {
  test('pauses, resumes and removes the instance through its routes', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { remote, local, plane, connectors } = await start();
    remote.start();
    await until('connected', () => remote.snapshot().status === 'connected');
    const paused = await readSnapshot(await local('/api/remote/disable', {}));
    expect(paused).toMatchObject({ paired: true, enabled: false, status: 'off' });
    expect(connectors[0]?.stopped).toBe(true);
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.offline)).toBe(true);
    expect(remote.resolveHookUrl('s1', 'tok')).toBeNull();
    expect((await readSnapshot(await local('/api/remote/enable', {}))).enabled).toBe(true);
    await until('tunnel restarted', () => connectors.length === 2);
    expect(remote.resolveHookUrl('s1', 'tok')).toBe(`${plane.origin}/app/hooks/k3x9/s1/tok`);
    plane.answers.set(REMOTE_PATHS.machineRemove, () => new Response('', { status: 500 }));
    const removed = await readSnapshot(await local('/api/remote/remove', {}));
    expect(removed).toMatchObject({ paired: false, enabled: false, devices: [] });
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.machineRemove)).toBe(true);
    for (const route of ['/api/remote/enable', '/api/remote/disable', '/api/remote/remove']) {
      expect(await readError(await local(route, {}))).toBe('remote_not_paired');
    }
    expect(await readError(await local('/api/remote/devices/enroll', { name: 'iPhone' }))).toBe(
      'remote_not_paired'
    );
    warn.mockRestore();
  });

  test('enrolls a named device from a one-time link and forgets it on request', async () => {
    const { remote, local, port } = await start();
    expect(await readError(await local('/api/remote/devices/enroll', { name: ' ' }))).toBe('name_invalid');
    expect(await readError(await local('/api/remote/devices/enroll', {}))).toBe('name_invalid');
    const enrollment = (await (await local('/api/remote/devices/enroll', { name: '  iPhone ' })).json()) as {
      url: string;
      name: string;
    };
    expect(enrollment.name).toBe('iPhone');
    const machine = await remote.store.resolveMachineKey();
    expect(enrollment.url.startsWith(`${remote.appOrigin}/app/enroll#`)).toBe(true);
    const fragment = parseEnrollFragment(new URL(enrollment.url).hash);
    expect(fragment).toMatchObject({ instanceId: 'k3x9', machineKey: machine.publicKey });
    const channel = await openChannel(remote.appOrigin, port, fragment?.secret ?? '', machine.publicKey);
    expect(await channel.next()).toEqual({ t: 'ready' });
    const listed = await readSnapshot(await local('/api/remote'));
    expect(listed.devices.map((device) => device.name)).toEqual(['iPhone']);
    expect(await readError(await local('/api/remote/devices/remove', { publicKey: 'nope' }))).toBe(
      'device_not_found'
    );
    expect(await readError(await local('/api/remote/devices/remove', {}))).toBe('publicKey_invalid');
    const key = listed.devices[0]?.publicKey ?? '';
    expect(
      (await readSnapshot(await local('/api/remote/devices/remove', { publicKey: key }))).devices
    ).toEqual([]);
    expect(await channel.closed).toBe(1008);
    const long = (await (await local('/api/remote/devices/enroll', { name: 'x'.repeat(80) })).json()) as {
      name: string;
    };
    expect(long.name).toHaveLength(60);
  });

  test('refuses from a remote device what stays at the keyboard, over HTTP as over the socket', async () => {
    const { remote, port } = await start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(
      remote.appOrigin,
      port,
      remote.enrollments.create('Phone').secret,
      machine.publicKey
    );
    expect(await channel.next()).toEqual({ t: 'ready' });
    const body = (text: string) => serializeBase64Url(new TextEncoder().encode(text));
    await channel.send({
      t: 'request',
      id: 'pair',
      method: 'POST',
      path: '/api/remote/disable',
      headers: [],
    });
    await channel.send({ t: 'end', id: 'pair' });
    await channel.send({ t: 'request', id: 'read', method: 'GET', path: '/api/remote', headers: [] });
    await channel.send({ t: 'end', id: 'read' });
    await channel.send({
      t: 'request',
      id: 'cmd',
      method: 'POST',
      path: '/api/commands',
      headers: [['content-type', 'application/json']],
    });
    await channel.send({
      t: 'body',
      id: 'cmd',
      chunk: body(JSON.stringify({ type: 'settings.change', patch: { mergeMethod: 'squash' } })),
    });
    await channel.send({ t: 'end', id: 'cmd' });
    const statuses = new Map<string, number>();
    while (statuses.size < 3) {
      const message = await channel.next();
      if (message.t === 'response') statuses.set(message.id, message.status);
    }
    expect(Object.fromEntries(statuses)).toEqual({ pair: 403, read: 200, cmd: 400 });
    expect(remote.snapshot().enabled).toBe(true);
  });
});

describe('naming and opening', () => {
  test('names the Mac after its host name without .local', () => {
    expect(resolveMachineName('Mona-MBP.local')).toBe('Mona-MBP');
    expect(resolveMachineName('')).toBe('Mac');
    expect(resolveMachineName()).not.toBe('');
  });

  test('opens a page with the system opener and reports when it fails', async () => {
    await openRemoteUrl('https://shinsa.dev/app/pair', createTempDir());
    await expect(openRemoteUrl('fail', createTempDir())).rejects.toThrow();
    await expect(createUrlOpener(createTempDir())('fail')).rejects.toThrow();
  });
});
