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
  type RemoteAccess,
  type RemoteUser,
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
import type { ShareChannel } from '../../src/remote/share-channel.ts';
import type { ShareLinks } from '../../src/remote/shares.ts';
import { Engine } from '../../src/runtime/index.ts';
import type { Schedules } from '../../src/schedules/index.ts';
import type { Slack } from '../../src/slack/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import {
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  overrideEnv,
  until,
} from '../helpers/index.ts';
import { createKeyPair, serializeDeviceKey, startHandshake, type TestSession } from './client.ts';
import { startFakeControlPlane } from './control-plane.ts';

const CONNECT_KEY = serializeBase64Url(new Uint8Array(32).fill(9));

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: CONNECT_KEY,
};

const OWNER: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI: RemoteUser = { id: '7', login: 'kai', name: null, avatarUrl: null };

const ACCESS: RemoteAccess = { owner: OWNER, members: [] };

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

function createModels(models: AgentModel[]) {
  return { listModels: () => Promise.resolve(models) } as unknown as ModelSource;
}

function createFakeSlack() {
  return {
    handleTunnel: () => Promise.resolve(new Response('mentioned', { status: 202 })),
    routes: () => [],
  } as unknown as Slack;
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
    access?: RemoteAccess | null;
    config?: Partial<ServerConfig>;
    openUrl?: (url: string) => Promise<void>;
    shares?: ShareLinks;
  } = {}
) {
  const config = createTestConfig(createTempDir(), options.config);
  const plane = startFakeControlPlane();
  running.push(plane.stop);
  const path = join(config.dataDir, 'remote.json');
  if (options.paired ?? true)
    writeFileSync(
      path,
      JSON.stringify({
        credentials: CREDENTIALS,
        enabled: options.enabled ?? true,
        owner: 'mona',
        access: options.access === undefined ? ACCESS : options.access,
      })
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
    ...(options.shares ? { shares: options.shares } : {}),
    slack: createFakeSlack(),
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

async function createToken(expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS, userId = OWNER.id) {
  return createConnectToken(CONNECT_KEY, { instanceId: 'k3x9', userId, expiresAt });
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
  machineKey: string,
  as: { userId?: string; device?: CryptoKeyPair; name?: string; onPending?: (socket: WebSocket) => void } = {}
): Promise<OpenChannel> {
  const token = await createToken(undefined, as.userId);
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
  let ended = false;
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener('close', (event) => {
      ended = true;
      for (const wake of waiters.splice(0)) wake();
      resolve(event.code);
    })
  );
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const take = async () => {
    while (inbox.length === 0) {
      if (ended) throw new Error('The channel closed.');
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    return inbox.shift() as string | Bytes;
  };
  const handshake = await startHandshake({
    machineKey,
    device: as.device ?? (await createKeyPair()),
    enrollSecret,
    ...(as.name ? { name: as.name } : {}),
  });
  socket.send(handshake.hello);
  let first = (await take()) as string;
  if (first === '{"type":"pending"}') {
    as.onPending?.(socket);
    first = (await take()) as string;
  }
  const session = await handshake.finish(first);
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

function settleChannel(opening: Promise<OpenChannel>) {
  return opening.then(
    () => 'opened',
    (error: unknown) => (error as Error).message
  );
}

async function addDevice(remote: Remote, userId = OWNER.id) {
  const device = await createKeyPair();
  remote.store.upsertDevice({
    publicKey: await serializeDeviceKey(device),
    name: 'Phone',
    enrolledAt: 1,
    lastSeenAt: null,
    userId,
  });
  return device;
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

  test('hands a Slack mention from app.shinsa.dev to the Slack service, and only as a POST', async () => {
    const { tunnel } = await start();
    const mentioned = await tunnel('/api/slack/events', { method: 'POST', body: '{}' });
    expect(mentioned.status).toBe(202);
    expect(await mentioned.text()).toBe('mentioned');
    expect((await tunnel('/api/slack/events')).status).toBe(404);
    expect((await tunnel('/api/slack', { method: 'POST', body: '{}' })).status).toBe(404);
  });

  test('keeps webhooks read-only in inspect mode', async () => {
    const { tunnel } = await start({ config: { inspect: true } });
    expect((await tunnel('/api/slack/events', { method: 'POST', body: '{}' })).status).toBe(403);
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

  test('opens a share link only from app.shinsa.dev and only for a task that is shared, and the machine closes it', async () => {
    const received: string[] = [];
    const closed: string[] = [];
    const shares = {
      acceptsShare: (shareId: string) => shareId === 's1',
      openChannel: (
        peer: { send: (data: string) => void; close: (code: number, reason: string) => void },
        shareId: string
      ) => {
        peer.send(`hello ${shareId}`);
        return {
          receive: (raw: string) => {
            received.push(raw);
            peer.close(1008, 'A share link accepts nothing.');
            return Promise.resolve();
          },
          close: () => closed.push(shareId),
        } as unknown as ShareChannel;
      },
      closeChannel: (channel: ShareChannel) => channel.close(),
    } as unknown as ShareLinks;
    const { tunnel, port, plane } = await start({ shares });
    expect((await tunnel('/share?id=s1')).status).toBe(403);
    expect((await tunnel('/share?id=nope', { headers: { origin: plane.origin } })).status).toBe(404);
    expect((await tunnel('/share', { headers: { origin: plane.origin } })).status).toBe(404);
    expect((await tunnel('/share?id=s1', { headers: { origin: plane.origin } })).status).toBe(400);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/share?id=s1`, {
      headers: { origin: plane.origin, 'cf-connecting-ip': '203.0.113.9' },
    } as unknown as string[]);
    const first = await new Promise<string>((resolve) => {
      socket.addEventListener('message', (event) => resolve(String(event.data)), { once: true });
    });
    expect(first).toBe('hello s1');
    const ended = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener('close', resolve, { once: true });
    });
    socket.send('hi');
    expect((await ended).code).toBe(1008);
    await until('the share link is closed', () => closed.length === 1);
    expect(received).toEqual(['hi']);
  });

  test('has no share link without the shares', async () => {
    const { tunnel } = await start();
    expect((await tunnel('/share?id=s1', { headers: { origin: REMOTE_APP_ORIGIN } })).status).toBe(404);
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
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote),
    });
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
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote),
    });
    expect(await channel.next()).toEqual({ t: 'ready' });
    await remote.stop();
    expect(await channel.closed).toBe(1008);
    expect(connectors[0]?.stopped).toBe(true);
  });

  test('closes a channel the browser closes without breaking the server', async () => {
    const { remote, port, tunnel } = await start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote),
    });
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
    plane.answers.set('/__remote/machine/heartbeat', () => new Response('', { status: 401 }));
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

describe('pairing this machine', () => {
  test('starts with GitHub sign-in in the browser and starts the tunnel once the instance is claimed', async () => {
    const { remote, local, plane, opened, connectors } = await start({ paired: false });
    let polls = 0;
    plane.answers.set(REMOTE_PATHS.pairStart, () =>
      Response.json({
        claimCode: 'K7PQ',
        pollSecret: 'poll',
        url: 'https://app.shinsa.dev/pair?code=K7PQ',
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
      url: 'https://app.shinsa.dev/pair?code=K7PQ',
      expiresAt: expect.any(Number),
    });
    expect(opened).toEqual(['https://app.shinsa.dev/pair?code=K7PQ']);
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

describe('managing remote access on the machine', () => {
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
    expect(remote.resolveHookUrl('s1', 'tok')).toBe(`${plane.origin}/hooks/k3x9/s1/tok`);
    plane.answers.set(REMOTE_PATHS.machineRemove, () => new Response('', { status: 500 }));
    const removed = await readSnapshot(await local('/api/remote/remove', {}));
    expect(removed).toMatchObject({ paired: false, enabled: false, devices: [] });
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.machineRemove)).toBe(true);
    for (const route of ['/api/remote/enable', '/api/remote/disable', '/api/remote/remove']) {
      expect(await readError(await local(route, {}))).toBe('remote_not_paired');
    }
    expect(await readError(await local('/api/remote/link/create', {}))).toBe('remote_not_paired');
    warn.mockRestore();
  });

  test('refuses from a remote device what stays at the keyboard, over HTTP as over the socket', async () => {
    const { remote, port } = await start();
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote),
    });
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

describe('links, access requests and members', () => {
  function answerAccess(access: RemoteAccess) {
    return () => Response.json({ ok: true, ...access });
  }

  function readLink(remote: Remote) {
    return parseEnrollFragment(new URL(remote.snapshot().link?.url ?? 'https://x').hash);
  }

  async function waitForRequest(remote: Remote) {
    await until('the request', () => remote.snapshot().requests.length > 0);
    return remote.snapshot().requests[0]?.id ?? '';
  }

  test('the one link is reusable, kept until turned off, and adds the owner’s device once accepted', async () => {
    const { remote, local, port, plane } = await start();
    const made = await readSnapshot(await local('/api/remote/link/create', {}));
    expect(made.link).toEqual(expect.objectContaining({ url: expect.stringContaining('/enroll#k3x9.') }));
    const first = readLink(remote);
    await local('/api/remote/link/create', {});
    const fragment = readLink(remote);
    expect(fragment).toMatchObject({ instanceId: 'k3x9', invite: 'invite-token' });
    expect(fragment?.secret).toBe(first?.secret);
    expect(plane.calls.filter((call) => call.path === REMOTE_PATHS.machineInvites)).toHaveLength(1);
    const machine = await remote.store.resolveMachineKey();
    for (const name of ['iPhone', 'Mac']) {
      let pending = false;
      const opening = openChannel(remote.appOrigin, port, fragment?.secret ?? '', machine.publicKey, {
        name,
        onPending: () => {
          pending = true;
        },
      });
      const requestId = await waitForRequest(remote);
      expect(remote.snapshot().requests[0]).toMatchObject({ deviceName: name, user: OWNER });
      const accepted = await readSnapshot(await local('/api/remote/requests/accept', { requestId }));
      expect(accepted.requests).toEqual([]);
      const channel = await opening;
      expect(pending).toBe(true);
      expect(await channel.next()).toEqual({ t: 'ready' });
    }
    expect(remote.snapshot().devices.map((device) => device.name)).toEqual(['iPhone', 'Mac']);
    expect(await readError(await local('/api/remote/requests/accept', { requestId: 'gone' }))).toBe(
      'request_not_found'
    );
    expect(await readError(await local('/api/remote/requests/accept', {}))).toBe('requestId_invalid');
  });

  test('a device that asks again keeps its one request, and several requests wait side by side', async () => {
    const { remote, local, port } = await start();
    await local('/api/remote/link/create', {});
    const secret = readLink(remote)?.secret ?? '';
    const machine = await remote.store.resolveMachineKey();
    const phone = await createKeyPair();
    const first = settleChannel(
      openChannel(remote.appOrigin, port, secret, machine.publicKey, { device: phone })
    );
    const requestId = await waitForRequest(remote);
    const again = settleChannel(
      openChannel(remote.appOrigin, port, secret, machine.publicKey, { device: phone, name: 'Phone' })
    );
    const laptop = settleChannel(
      openChannel(remote.appOrigin, port, secret, machine.publicKey, { name: 'Laptop' })
    );
    await until('both requests', () => remote.snapshot().requests.length === 2);
    expect(
      remote.snapshot().requests.map((request) => [request.id === requestId, request.deviceName])
    ).toEqual([
      [true, 'Phone'],
      [false, 'Laptop'],
    ]);
    await local('/api/remote/requests/accept', { requestId });
    expect(await first).toBe('opened');
    expect(await again).toBe('opened');
    await local('/api/remote/requests/decline', { requestId: remote.snapshot().requests[0]?.id });
    expect(await laptop).toContain('declined');
  });

  test('a device that left comes back without the link and waits on its request, or is refused once it is gone', async () => {
    const { remote, local, port } = await start();
    await local('/api/remote/link/create', {});
    const secret = readLink(remote)?.secret ?? '';
    const machine = await remote.store.resolveMachineKey();
    const phone = await createKeyPair();
    const left = settleChannel(
      openChannel(remote.appOrigin, port, secret, machine.publicKey, {
        device: phone,
        onPending: (socket) => socket.close(),
      })
    );
    const requestId = await waitForRequest(remote);
    expect(await left).toBe('The channel closed.');
    const back = settleChannel(openChannel(remote.appOrigin, port, '', machine.publicKey, { device: phone }));
    const other = settleChannel(
      openChannel(remote.appOrigin, port, '', machine.publicKey, { device: phone, userId: KAI.id })
    );
    expect(await other).toContain('not added');
    await local('/api/remote/requests/accept', { requestId });
    expect(await back).toBe('opened');
    const stranger = settleChannel(openChannel(remote.appOrigin, port, '', machine.publicKey));
    expect(await stranger).toContain('Ask for access with its link first');
  });

  test('a declined request is forgotten and the browser is told', async () => {
    const { remote, local, port } = await start();
    await local('/api/remote/link/create', {});
    const fragment = readLink(remote);
    const machine = await remote.store.resolveMachineKey();
    const opening = settleChannel(
      openChannel(remote.appOrigin, port, fragment?.secret ?? '', machine.publicKey)
    );
    const requestId = await waitForRequest(remote);
    expect(remote.snapshot().requests[0]?.deviceName).toBe('Browser');
    await local('/api/remote/requests/decline', { requestId });
    expect(await opening).toContain('declined');
    expect(remote.snapshot().requests).toEqual([]);
    expect(remote.snapshot().devices).toEqual([]);
  });

  test('the link is refused before the owner is known and once turned off', async () => {
    const { remote, local, port, plane } = await start();
    await local('/api/remote/link/create', {});
    const secret = readLink(remote)?.secret ?? '';
    const machine = await remote.store.resolveMachineKey();
    await expect(openChannel(remote.appOrigin, port, '', machine.publicKey)).rejects.toThrow('not added');
    const off = await readSnapshot(await local('/api/remote/link/remove', {}));
    expect(off.link).toBeNull();
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.machineInviteRemove)).toBe(true);
    await expect(openChannel(remote.appOrigin, port, secret, machine.publicKey)).rejects.toThrow(
      'turned off'
    );
    const unknown = await start({ access: null });
    await unknown.local('/api/remote/link/create', {});
    const unknownKey = await unknown.remote.store.resolveMachineKey();
    await expect(
      openChannel(
        unknown.remote.appOrigin,
        unknown.port,
        readLink(unknown.remote)?.secret ?? '',
        unknownKey.publicKey
      )
    ).rejects.toThrow('still connecting');
  });

  test('accepting a request from another account makes it a member and adds its device for it', async () => {
    const { remote, local, port, plane } = await start();
    plane.answers.set(REMOTE_PATHS.machineRequester, () => Response.json(KAI));
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => Response.json({ user: KAI, addedAt: 5 }));
    await local('/api/remote/link/create', {});
    const fragment = readLink(remote);
    const machine = await remote.store.resolveMachineKey();
    const opening = openChannel(remote.appOrigin, port, fragment?.secret ?? '', machine.publicKey, {
      userId: KAI.id,
      name: 'Kai iPhone',
    });
    const requestId = await waitForRequest(remote);
    expect(remote.snapshot().requests[0]).toMatchObject({
      user: KAI,
      deviceName: 'Kai iPhone',
    });
    expect(plane.calls.find((call) => call.path === REMOTE_PATHS.machineRequester)?.body).toEqual({
      userId: KAI.id,
    });
    await local('/api/remote/requests/accept', { requestId });
    expect(await (await opening).next()).toEqual({ t: 'ready' });
    expect(remote.snapshot().access?.members).toEqual([{ user: KAI, addedAt: 5 }]);
    expect(remote.snapshot().devices).toEqual([
      expect.objectContaining({ name: 'Kai iPhone', userId: KAI.id }),
    ]);
  });

  test('accepting a request on a machine with every member place taken says so and keeps the request', async () => {
    const { remote, local, port, plane } = await start();
    plane.answers.set(REMOTE_PATHS.machineRequester, () => Response.json(KAI));
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => new Response('', { status: 409 }));
    await local('/api/remote/link/create', {});
    const machine = await remote.store.resolveMachineKey();
    void openChannel(remote.appOrigin, port, readLink(remote)?.secret ?? '', machine.publicKey, {
      userId: KAI.id,
    }).catch((error: unknown) => error);
    const requestId = await waitForRequest(remote);
    expect(await readError(await local('/api/remote/requests/accept', { requestId }))).toBe('members_full');
    expect(remote.snapshot().requests.map((entry) => entry.id)).toEqual([requestId]);
    expect(remote.snapshot().devices).toEqual([]);
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => new Response('', { status: 500 }));
    expect(await readError(await local('/api/remote/requests/accept', { requestId }))).not.toBe(
      'members_full'
    );
    remote.declineRequest(requestId);
  });

  test('a request from a member adds only the device', async () => {
    const { remote, local, port, plane } = await start({
      access: { owner: OWNER, members: [{ user: KAI, addedAt: 1 }] },
    });
    plane.answers.set(REMOTE_PATHS.machineRequester, () => Response.json(KAI));
    await local('/api/remote/link/create', {});
    const fragment = readLink(remote);
    const machine = await remote.store.resolveMachineKey();
    const opening = openChannel(remote.appOrigin, port, fragment?.secret ?? '', machine.publicKey, {
      userId: KAI.id,
    });
    await local('/api/remote/requests/accept', { requestId: await waitForRequest(remote) });
    await opening;
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.machineMemberAdd)).toBe(false);
  });

  test('a request is refused when the machine cannot check who asked', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { remote, local, port, plane } = await start();
    plane.answers.set(REMOTE_PATHS.machineRequester, () => new Response('', { status: 404 }));
    await local('/api/remote/link/create', {});
    const machine = await remote.store.resolveMachineKey();
    await expect(
      openChannel(remote.appOrigin, port, readLink(remote)?.secret ?? '', machine.publicKey, {
        userId: KAI.id,
      })
    ).rejects.toThrow('could not check who you are');
    warn.mockRestore();
  });

  test('approving works from a device that reaches the machine remotely, and links stay at the keyboard', async () => {
    const { remote, local, port } = await start();
    await local('/api/remote/link/create', {});
    const machine = await remote.store.resolveMachineKey();
    const admin = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote),
    });
    expect(await admin.next()).toEqual({ t: 'ready' });
    const opening = openChannel(remote.appOrigin, port, readLink(remote)?.secret ?? '', machine.publicKey);
    const requestId = await waitForRequest(remote);
    const body = (text: string) => serializeBase64Url(new TextEncoder().encode(text));
    const post = async (id: string, path: string, json: unknown) => {
      await admin.send({
        t: 'request',
        id,
        method: 'POST',
        path,
        headers: [['content-type', 'application/json']],
      });
      await admin.send({ t: 'body', id, chunk: body(JSON.stringify(json)) });
      await admin.send({ t: 'end', id });
      for (;;) {
        const message = await admin.next();
        if (message.t === 'response' && message.id === id) return message.status;
      }
    };
    expect(await post('a', '/api/remote/link/create', {})).toBe(403);
    expect(await post('b', '/api/remote/requests/accept', { requestId })).toBe(200);
    expect(await (await opening).next()).toEqual({ t: 'ready' });
  });

  test('a device opens only for the account that added it, and older devices only for the owner', async () => {
    const { remote, port } = await start();
    const machine = await remote.store.resolveMachineKey();
    const kaiDevice = await addDevice(remote, KAI.id);
    const legacyDevice = await createKeyPair();
    remote.store.upsertDevice({
      publicKey: await serializeDeviceKey(legacyDevice),
      name: 'Phone',
      enrolledAt: 1,
      lastSeenAt: null,
      userId: null,
    });
    await expect(
      openChannel(remote.appOrigin, port, '', machine.publicKey, { device: kaiDevice })
    ).rejects.toThrow('not added');
    const kai = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: kaiDevice,
      userId: KAI.id,
    });
    expect(await kai.next()).toEqual({ t: 'ready' });
    await expect(
      openChannel(remote.appOrigin, port, '', machine.publicKey, { device: legacyDevice, userId: KAI.id })
    ).rejects.toThrow('not added');
    const legacy = await openChannel(remote.appOrigin, port, '', machine.publicKey, { device: legacyDevice });
    expect(await legacy.next()).toEqual({ t: 'ready' });
  });

  test('a heartbeat that no longer lists a member forgets their devices and closes their sessions', async () => {
    const { remote, port, plane } = await start({
      access: { owner: OWNER, members: [{ user: KAI, addedAt: 1 }] },
    });
    const machine = await remote.store.resolveMachineKey();
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, {
      device: await addDevice(remote, KAI.id),
      userId: KAI.id,
    });
    expect(await channel.next()).toEqual({ t: 'ready' });
    const pushes: number[] = [];
    const release = remote.subscribe(() => pushes.push(1));
    plane.answers.set(
      REMOTE_PATHS.heartbeat,
      answerAccess({ owner: OWNER, members: [{ user: KAI, addedAt: 1 }] })
    );
    remote.start();
    await until('connected', () => remote.snapshot().status === 'connected');
    const settled = pushes.length;
    await remote.supervisor.requestHeartbeat();
    expect(pushes.length).toBe(settled);
    plane.answers.set(REMOTE_PATHS.heartbeat, answerAccess(ACCESS));
    await remote.supervisor.requestHeartbeat();
    expect(remote.snapshot().access).toEqual(ACCESS);
    expect(remote.snapshot().devices).toEqual([]);
    expect(await channel.closed).toBe(1008);
    release();
  });

  test('forgets a device on request and closes its session', async () => {
    const { remote, local, port } = await start();
    const machine = await remote.store.resolveMachineKey();
    const device = await addDevice(remote);
    const channel = await openChannel(remote.appOrigin, port, '', machine.publicKey, { device });
    expect(await channel.next()).toEqual({ t: 'ready' });
    expect(await readError(await local('/api/remote/devices/remove', { publicKey: 'nope' }))).toBe(
      'device_not_found'
    );
    expect(await readError(await local('/api/remote/devices/remove', {}))).toBe('publicKey_invalid');
    const key = await serializeDeviceKey(device);
    expect(
      (await readSnapshot(await local('/api/remote/devices/remove', { publicKey: key }))).devices
    ).toEqual([]);
    expect(await channel.closed).toBe(1008);
  });

  test('removing a member tells Shinsa Cloud, then forgets their devices', async () => {
    const { remote, local, plane } = await start({
      access: { owner: OWNER, members: [{ user: KAI, addedAt: 1 }] },
    });
    await addDevice(remote, KAI.id);
    const mine = await serializeDeviceKey(await addDevice(remote));
    expect(await readError(await local('/api/remote/members/remove', {}))).toBe('userId_invalid');
    expect(await readError(await local('/api/remote/members/remove', { userId: '99' }))).toBe(
      'member_not_found'
    );
    const removed = await readSnapshot(await local('/api/remote/members/remove', { userId: KAI.id }));
    expect(removed.access?.members).toEqual([]);
    expect(removed.devices.map((device) => device.publicKey)).toEqual([mine]);
    expect(plane.calls.find((call) => call.path === REMOTE_PATHS.machineMemberRemove)).toMatchObject({
      token: 'machine',
      body: { userId: KAI.id },
    });
  });

  test('removing the machine forgets who has access, its links and its requests, and tells waiting browsers no', async () => {
    const { remote, local, port } = await start();
    await local('/api/remote/link/create', {});
    const machine = await remote.store.resolveMachineKey();
    const opening = settleChannel(
      openChannel(remote.appOrigin, port, readLink(remote)?.secret ?? '', machine.publicKey)
    );
    await waitForRequest(remote);
    const removed = await readSnapshot(await local('/api/remote/remove', {}));
    expect(removed).toMatchObject({ access: null, link: null, requests: [] });
    expect(await opening).toBe('The channel closed.');
  });
});

describe('naming and opening', () => {
  test('names the machine after its host name without .local', () => {
    expect(resolveMachineName('Mona-MBP.local')).toBe('Mona-MBP');
    expect(resolveMachineName('')).toBe('Machine');
    expect(resolveMachineName('MAC.local')).toBe('Mac');
    expect(resolveMachineName('STUDIO-MINI')).toBe('Studio-Mini');
    expect(resolveMachineName()).not.toBe('');
  });

  test('opens a page with the system opener and reports when it fails', async () => {
    const restore = overrideEnv({ DISPLAY: ':0' });
    try {
      await openRemoteUrl('https://app.shinsa.dev/pair', createTempDir());
      await expect(openRemoteUrl('fail', createTempDir())).rejects.toThrow();
      await expect(createUrlOpener(createTempDir())('fail')).rejects.toThrow();
    } finally {
      restore();
    }
  });

  test('opens nothing on a machine without a display, since the command prints the pairing page', async () => {
    await openRemoteUrl('fail', createTempDir(), null);
  });
});
