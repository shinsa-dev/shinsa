import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PREVIEW_GONE,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  PREVIEW_PAGE_HEADER,
  PREVIEW_STOPPED,
  type PreviewShare,
  parsePreviewUrl,
  resolvePreviewTunnelPath,
  type ServiceDefinition,
  type ShinsaState,
  serializeBase64Url,
  serializePreviewUrl,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import {
  PREVIEW_LINK_LOST,
  PREVIEW_NO_URL,
  PREVIEW_NOT_PAIRED,
  type PreviewAnswer,
  type PreviewPeer,
  Previews,
  resolveCloseCode,
  resolveForwardHeaders,
} from '../../src/remote/previews.ts';
import { EffectError } from '../../src/runtime/failures.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createStubEngine, createTask } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const ORIGIN = 'https://shinsa.page';

const CREDENTIALS = {
  instanceId: 'inst1',
  machineToken: 'machine-token',
  tunnelToken: 'tunnel',
  tunnelHost: 't-inst1.shinsa.dev',
  connectKey: 'key',
};

const CONTEXT = { key: 'preview.link:task-1:web:1', attempt: 1, signal: new AbortController().signal };

const PREVIEW_ID = serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(3));

const KEY = serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(5));

const URL_HERE = serializePreviewUrl({ instanceId: 'inst1', previewId: PREVIEW_ID, key: KEY }, ORIGIN);

const stops: (() => unknown)[] = [];

let plane: FakeControlPlane | null = null;

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await plane?.stop();
  plane = null;
});

function createService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: 'web',
    projectId: 'project-1',
    name: 'web',
    cwd: '.',
    command: 'bun dev',
    env: {},
    previewUrl: 'http://localhost:{port}',
    portVariable: 'PORT',
    ...overrides,
  };
}

function createRun(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: 'term-1',
    projectId: 'project-1',
    name: null,
    title: null,
    cwd: '/tmp',
    place: 'worktree',
    taskId: 'task-1',
    serviceId: 'web',
    port: 1,
    status: 'running',
    exitCode: null,
    startedAt: 1,
    endedAt: null,
    ...overrides,
  } as TerminalInfo;
}

function createPreview(overrides: Partial<PreviewShare> = {}): PreviewShare {
  return { serviceId: 'web', at: 1, url: URL_HERE, limit: 'none', endsAt: null, ...overrides };
}

interface SetUp {
  paired?: boolean;
  seeded?: boolean;
  preview?: PreviewShare | null;
  patch?: (state: ShinsaState) => void;
  now?: () => number;
}

function setUp(options: SetUp = {}) {
  plane = startFakeControlPlane();
  const dir = createTempDir();
  const path = join(dir, 'remote.json');
  if (options.paired ?? true)
    writeFileSync(path, JSON.stringify({ credentials: CREDENTIALS, enabled: true, owner: 'mona' }));
  const remote = new Remote({
    path,
    control: new ControlClient({ origin: plane.origin }),
    connect: () => Promise.reject(new Error('no tunnel in this test')),
    localUrl: () => 'http://127.0.0.1:1',
    version: '1',
    maxBodyBytes: 1024,
    machineName: 'Studio',
    openUrl: () => Promise.resolve(),
  });
  const stub = createStubEngine((state) => {
    const preview = options.preview === undefined ? createPreview() : options.preview;
    state.tasks['task-1'] = createTask({ previews: preview ? [preview] : [] });
    options.patch?.(state);
  });
  const snapshot: TerminalsSnapshot = { terminals: [createRun()], services: [createService()], home: '/tmp' };
  let fill = 7;
  const previews = new Previews({
    engine: stub.engine,
    remote,
    services: { snapshot: () => snapshot },
    origin: ORIGIN,
    ...(options.seeded === false ? {} : { random: (bytes: number) => new Uint8Array(bytes).fill(fill++) }),
    ...(options.now ? { now: options.now } : {}),
  });
  return { stub, remote, previews, snapshot };
}

function ask(previews: Previews, path: string, init: RequestInit & { key?: string | null } = {}) {
  const { key = KEY, ...rest } = init;
  const url = `https://t-inst1.shinsa.dev${resolvePreviewTunnelPath(PREVIEW_ID, path)}`;
  const headers = new Headers(rest.headers);
  if (key) headers.set(PREVIEW_KEY_HEADER, key);
  return previews.answer(new Request(url, { ...rest, headers }), new URL(url));
}

function readResponse(answer: PreviewAnswer) {
  if (answer.kind !== 'response') throw new Error('expected a response');
  return answer.response;
}

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function startDevServer() {
  const seen: Seen[] = [];
  const own = { port: 0 };
  const server: Bun.Server<undefined> = Bun.serve<undefined>({
    port: 0,
    async fetch(request, bunServer): Promise<Response | undefined> {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      });
      if (url.pathname === '/hmr') {
        const protocol = request.headers.get('sec-websocket-protocol') ?? '';
        if (bunServer.upgrade(request, { data: undefined, headers: { 'Sec-WebSocket-Protocol': protocol } }))
          return undefined;
      }
      if (url.pathname === '/away')
        return new Response(null, {
          status: 302,
          headers: { location: `http://localhost:${own.port}/home` },
        });
      return new Response(`hello ${url.pathname}`, {
        headers: { 'content-type': 'text/plain', connection: 'keep-alive', 'set-cookie': 'sid=1' },
      });
    },
    websocket: {
      message: (socket, message) => {
        if (message === 'close') socket.close(4001, 'asked');
        else if (message === 'drop') socket.terminate();
        else socket.send(typeof message === 'string' ? `echo ${message}` : message);
      },
    },
  });
  own.port = server.port as number;
  stops.push(() => server.stop(true));
  return { seen, port: own.port };
}

interface FakePeer extends PreviewPeer {
  received: (string | number)[];
  closed: { code: number; reason: string } | null;
}

function createPeer(): FakePeer {
  const peer: FakePeer = {
    received: [],
    closed: null,
    send: (data) => peer.received.push(typeof data === 'string' ? data : data.length),
    close: (code, reason) => {
      peer.closed = { code, reason };
    },
  };
  return peer;
}

describe('making a preview link', () => {
  test('a new preview gets a link on its own host under the preview origin, with a fresh id and key', async () => {
    const { previews, stub } = setUp({ preview: createPreview({ url: null }) });
    await previews.link('task-1', 'web', CONTEXT);
    const [command] = stub.dispatched;
    expect(command).toMatchObject({ type: 'preview.record', taskId: 'task-1', serviceId: 'web' });
    const url = command?.type === 'preview.record' ? command.url : null;
    expect(url?.startsWith('https://')).toBe(true);
    expect(parsePreviewUrl(url, ORIGIN)).toEqual({
      instanceId: 'inst1',
      previewId: serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(7)),
      key: serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(8)),
    });
    expect(stub.commandIds).toEqual([`${CONTEXT.key}:preview.record`]);
  });

  test('two new links never share an id or a key', async () => {
    const urls: (string | null)[] = [];
    for (let made = 0; made < 2; made++) {
      const { previews, stub } = setUp({ preview: createPreview({ url: null }), seeded: false });
      await previews.link('task-1', 'web', CONTEXT);
      const [command] = stub.dispatched;
      urls.push(command?.type === 'preview.record' ? command.url : null);
    }
    const [first, second] = urls.map((url) => parsePreviewUrl(url, ORIGIN));
    expect(first && second).toBeTruthy();
    expect(first?.previewId).not.toBe(second?.previewId);
    expect(first?.key).not.toBe(second?.key);
  });

  test('a link that already reaches this machine is kept, and a preview gone in the meantime makes nothing', async () => {
    const { previews, stub } = setUp();
    await previews.link('task-1', 'web', CONTEXT);
    expect(stub.dispatched).toEqual([
      { type: 'preview.record', taskId: 'task-1', serviceId: 'web', url: null },
    ]);
    await previews.link('task-1', 'api', CONTEXT);
    expect(stub.dispatched).toHaveLength(1);
  });

  test('an unpaired machine and a service without a preview URL cannot make one, and say why', async () => {
    const unpaired = setUp({ paired: false });
    const refused = unpaired.previews.link('task-1', 'web', CONTEXT);
    await expect(refused).rejects.toThrow(EffectError);
    await expect(refused).rejects.toThrow(PREVIEW_NOT_PAIRED);
    const plain = setUp();
    plain.snapshot.services[0] = createService({ previewUrl: null });
    await expect(plain.previews.link('task-1', 'web', CONTEXT)).rejects.toThrow(PREVIEW_NO_URL);
  });

  test('unpairing marks every live link as lost, and a failure to say so is logged', async () => {
    const { remote, stub } = setUp({
      patch: (state) => {
        state.tasks['task-2'] = createTask({
          id: 'task-2',
          previews: [createPreview({ url: null }), createPreview({ serviceId: 'api', failure: 'old' })],
        });
      },
    });
    stub.reject((command) => command.type === 'preview.fail', new Error('log closed'));
    const logged = spyOn(log, 'error').mockImplementation(() => undefined);
    await remote.disable();
    expect(stub.dispatched).toEqual([]);
    await remote.remove();
    await until('the lost link is reported', () => logged.mock.calls.length === 1);
    expect(stub.dispatched).toEqual([
      { type: 'preview.fail', taskId: 'task-1', serviceId: 'web', detail: PREVIEW_LINK_LOST },
    ]);
    logged.mockRestore();
  });
});

describe('answering a preview request', () => {
  test('a wrong, missing or stale key, an ended share and a path that names no preview are all one page', async () => {
    let now = 10;
    const { previews } = setUp({ preview: createPreview({ endsAt: 20 }), now: () => now });
    const wrong = serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(6));
    for (const key of [wrong, null, 'short']) {
      const response = readResponse(await ask(previews, '/', { key }));
      expect(response.status).toBe(404);
      expect(await response.text()).toContain(PREVIEW_GONE);
    }
    const unnamed = new Request('https://t-inst1.shinsa.dev/__preview/nope/');
    expect(readResponse(await previews.answer(unnamed, new URL(unnamed.url))).status).toBe(404);
    now = 20;
    expect(readResponse(await ask(previews, '/')).status).toBe(404);
  });

  test('an unpaired machine and a link to another machine answer nothing', async () => {
    expect(readResponse(await ask(setUp({ paired: false }).previews, '/')).status).toBe(404);
    const elsewhere = serializePreviewUrl({ instanceId: 'inst9', previewId: PREVIEW_ID, key: KEY }, ORIGIN);
    const other = setUp({ preview: createPreview({ url: elsewhere }) });
    expect(readResponse(await ask(other.previews, '/')).status).toBe(404);
  });

  test('a service that is not running says so, until it runs again', async () => {
    const { previews, snapshot } = setUp();
    snapshot.terminals[0] = createRun({ status: 'exited', port: null });
    const stopped = readResponse(await ask(previews, '/'));
    expect(stopped.status).toBe(503);
    expect(stopped.headers.get('cache-control')).toBe('no-store');
    expect(stopped.headers.get(PREVIEW_PAGE_HEADER)).toBe('1');
    expect(await stopped.text()).toContain(PREVIEW_STOPPED);
    snapshot.terminals = [];
    expect(readResponse(await ask(previews, '/')).status).toBe(503);
  });

  test('a request reaches the run as if made on the machine itself, and its answer comes back as it is', async () => {
    const dev = startDevServer();
    const { previews, snapshot } = setUp();
    snapshot.terminals[0] = createRun({ port: dev.port });
    const response = readResponse(
      await ask(previews, '/api/save?draft=1', {
        method: 'POST',
        body: 'saved',
        headers: {
          origin: 'https://abc.shinsa.page',
          referer: 'https://abc.shinsa.page/edit?x=1',
          cookie: 'sid=1',
          'cf-ray': 'ray',
          'cf-connecting-ip': '203.0.113.9',
        },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello /api/save');
    expect(response.headers.get('set-cookie')).toBe('sid=1');
    expect(response.headers.has('connection')).toBe(false);
    const [request] = dev.seen;
    expect(request).toMatchObject({ method: 'POST', path: '/api/save?draft=1', body: 'saved' });
    expect(request?.headers).toMatchObject({
      host: `localhost:${dev.port}`,
      origin: `http://localhost:${dev.port}`,
      referer: `http://localhost:${dev.port}/edit?x=1`,
      cookie: 'sid=1',
    });
    expect(request?.headers[PREVIEW_KEY_HEADER]).toBeUndefined();
    expect(request?.headers['cf-ray']).toBeUndefined();
  });

  test('a redirect to the run stays on the preview, and a run that refuses the connection says it is not running', async () => {
    const dev = startDevServer();
    const { previews, snapshot } = setUp();
    snapshot.terminals[0] = createRun({ port: dev.port });
    const redirect = readResponse(await ask(previews, '/away'));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/home');
    const refused = Bun.serve({ port: 0, fetch: () => new Response() });
    const closedPort = refused.port as number;
    await refused.stop(true);
    snapshot.terminals[0] = createRun({ port: closedPort });
    const warned = spyOn(log, 'warn').mockImplementation(() => undefined);
    const down = readResponse(await ask(previews, '/'));
    expect(down.status).toBe(502);
    expect(down.headers.get(PREVIEW_PAGE_HEADER)).toBe('1');
    expect(await down.text()).toContain(PREVIEW_STOPPED);
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
  });
});

describe('relaying a preview socket', () => {
  async function openRelay(protocols = ['vite-hmr']) {
    const dev = startDevServer();
    const setup = setUp();
    setup.snapshot.terminals[0] = createRun({ port: dev.port });
    const answer = await ask(setup.previews, '/hmr?token=1', {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': protocols.join(', '),
        'sec-websocket-key': 'k',
      },
    });
    if (answer.kind !== 'upgrade') throw new Error('expected an upgrade');
    const peer = createPeer();
    const relay = setup.previews.openSocket(peer, answer.upgrade);
    return { ...setup, dev, answer, peer, relay };
  }

  test('an upgrade names the run’s socket and its subprotocol, without the browser’s handshake headers', async () => {
    const { answer, dev } = await openRelay(['vite-hmr', 'other']);
    if (answer.kind !== 'upgrade') throw new Error('expected an upgrade');
    expect(answer.upgrade.target).toBe(`ws://localhost:${dev.port}/hmr?token=1`);
    expect(answer.upgrade.protocols).toEqual(['vite-hmr', 'other']);
    expect(answer.upgrade.headers['sec-websocket-key']).toBeUndefined();
    expect(answer.upgrade.headers.host).toBe(`localhost:${dev.port}`);
  });

  test('messages sent before the run answers wait, then go both ways in text and bytes', async () => {
    const { peer, relay, dev } = await openRelay();
    relay.send('first');
    await until('the first echo', () => peer.received.length === 1);
    relay.send(new Uint8Array([1, 2]));
    await until('the bytes come back', () => peer.received.length === 2);
    expect(peer.received).toEqual(['echo first', 2]);
    const upgraded = dev.seen.find((request) => request.path === '/hmr?token=1');
    expect(upgraded?.headers['sec-websocket-protocol']).toBe('vite-hmr');
  });

  test('the run closing ends the browser’s socket with its code, or a normal one it cannot send', async () => {
    const asked = await openRelay();
    asked.relay.send('close');
    await until('the socket ends', () => asked.peer.closed !== null);
    expect(asked.peer.closed).toEqual({ code: 4001, reason: 'asked' });
    const dropped = await openRelay();
    dropped.relay.send('drop');
    await until('the socket ends', () => dropped.peer.closed !== null);
    expect(dropped.peer.closed?.code).toBe(1000);
    dropped.relay.send('late');
  });

  test('the browser leaving closes the run’s socket and nothing reaches the browser after', async () => {
    const { peer, relay } = await openRelay();
    relay.send('first');
    await until('the first echo', () => peer.received.length === 1);
    relay.close();
    await Bun.sleep(0);
    expect(peer.closed).toBeNull();
  });

  test('stopping sharing ends every socket open on the preview at once', async () => {
    const { peer, relay, stub } = await openRelay();
    relay.send('first');
    await until('the first echo', () => peer.received.length === 1);
    stub.update((state) => {
      const task = state.tasks['task-1'];
      if (task) task.previews = [];
    });
    stub.notify();
    expect(peer.closed).toEqual({ code: 1000, reason: PREVIEW_GONE });
  });
});

describe('the headers and codes a preview passes on', () => {
  test('a referer that is not a URL becomes the run’s origin, and an origin-less request gets none', () => {
    const headers = resolveForwardHeaders(new Headers({ referer: 'not a url', accept: '*/*' }), 9);
    expect(headers).toEqual({ referer: 'http://localhost:9', accept: '*/*', host: 'localhost:9' });
  });

  test('a close code a server may not send becomes a normal close', () => {
    expect(resolveCloseCode(4001)).toBe(4001);
    expect(resolveCloseCode(1006)).toBe(1000);
    expect(resolveCloseCode(1005)).toBe(1000);
    expect(resolveCloseCode(999)).toBe(1000);
  });
});
