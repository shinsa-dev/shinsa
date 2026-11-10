import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_TEAM_SCOPES,
  REMOTE_APP_ORIGIN,
  REMOTE_KEY_ALGORITHM,
  type RemoteTeam,
  serializePrivateKey,
  serializePublicKey,
  type TeamMachine,
} from '@shinsa/core';
import { NotFound } from '@shinsa/core/remote/errors';
import { Context, Effect, Exit, Layer, Redacted, Scope } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { describeBodyLimit } from '../../src/http/guard.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { ChannelPeer } from '../../src/remote/channel/schema.ts';
import { RemoteUnreachable } from '../../src/remote/client/schema.ts';
import { RemoteClient } from '../../src/remote/client/service.ts';
import {
  DEVICE_CHANNEL_MESSAGES,
  DeviceChannelError,
  type DeviceChannelLink,
  type DeviceChannelOptions,
  type DeviceChannelRequest,
  DeviceRequestAborted,
} from '../../src/remote/device-channel/schema.ts';
import { DeviceChannels } from '../../src/remote/device-channel/service.ts';
import {
  FLEET_RELAY_MESSAGES,
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CLOSE,
} from '../../src/remote/fleet-relay/schema.ts';
import { FleetRelay } from '../../src/remote/fleet-relay/service.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import type { RelayDevice, RemoteFile } from '../../src/remote/store/schema.ts';
import { RemoteStore } from '../../src/remote/store/service.ts';
import type { TeamFeedGrant } from '../../src/remote/team-feeds/schema.ts';
import { TeamFeeds } from '../../src/remote/team-feeds/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';

const KAI_MAC: TeamMachine = { id: 'kai-mac', name: 'Kai’s Mac', userId: '7', online: true, lastSeenAt: 1 };

const LEE_MAC: TeamMachine = { id: 'lee-mac', name: 'Lee’s Mac', userId: '8', online: true, lastSeenAt: 1 };

const TEAM: RemoteTeam = {
  id: 'team1',
  name: 'Core',
  owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
  role: 'member',
  members: [],
  requests: [],
  machines: [KAI_MAC, LEE_MAC],
  scopes: DEFAULT_TEAM_SCOPES,
  overrides: [],
  createdAt: 1,
};

const PAIRED: Partial<RemoteFile> = {
  enabled: true,
  credentials: {
    instanceId: 'studio',
    machineToken: 'studio-token',
    tunnelToken: 't',
    tunnelHost: 'h',
    connectKey: 'c',
  },
  teams: [TEAM],
  teamKeys: [{ teamId: 'team1', name: 'Core', key: 'k', invite: null, addedAt: 1 }],
};

const KAI_GRANT: TeamFeedGrant = {
  teamId: 'team1',
  machine: KAI_MAC,
  machineKey: 'kai-key',
  grant: 'kai-grant',
};

const KAI_DEVICE: RelayDevice = {
  instanceId: 'kai-mac',
  teamId: 'team1',
  machineKey: 'kai-key',
  publicKey: 'pk',
  privateKey: 'sk',
  enrolledAt: 1,
};

interface FakeLink {
  readonly link: DeviceChannelLink;
  readonly requests: DeviceChannelRequest[];
  readonly sent: string[];
  closed: boolean;
  emit(data: string): void;
  drop(error: DeviceChannelError): void;
  isWatched(): boolean;
}

type Answer = (
  input: DeviceChannelRequest
) => Effect.Effect<Response, DeviceChannelError | DeviceRequestAborted>;

function createLink(answer?: Answer): FakeLink {
  const socketListeners = new Set<(data: string) => void>();
  const unheard: string[] = [];
  const closeListeners = new Set<(error: DeviceChannelError) => void>();
  const fake: FakeLink = {
    requests: [],
    sent: [],
    closed: false,
    emit: (data) => {
      if (socketListeners.size === 0) unheard.push(data);
      for (const listener of socketListeners) listener(data);
    },
    drop: (error) => {
      fake.closed = true;
      for (const listener of closeListeners) listener(error);
    },
    isWatched: () => closeListeners.size > 0,
    link: {
      isOpen: Effect.sync(() => !fake.closed),
      request: (input) => {
        fake.requests.push(input);
        return answer ? answer(input) : Effect.succeed(new Response(`answer ${input.path}`));
      },
      sendSocket: (data) =>
        fake.closed
          ? Effect.fail(new DeviceChannelError({ message: DEVICE_CHANNEL_MESSAGES.closed, refused: false }))
          : Effect.sync(() => void fake.sent.push(data)),
      subscribeSocket: (listener) => {
        socketListeners.add(listener);
        for (const data of unheard.splice(0)) listener(data);
        return () => socketListeners.delete(listener);
      },
      subscribeClose: (listener) => {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      close: Effect.sync(() => {
        if (fake.closed) return;
        fake.drop(new DeviceChannelError({ message: DEVICE_CHANNEL_MESSAGES.closedHere, refused: false }));
      }),
    },
  };
  return fake;
}

type Opened = FakeLink | DeviceChannelError;

interface World {
  readonly dataDir: string;
  grants: TeamFeedGrant[];
  readonly opens: DeviceChannelOptions[];
  readonly connects: { token: string; teamId: string; instanceId: string }[];
  readonly links: FakeLink[];
  next: Opened[];
  connect: () => Effect.Effect<{ url: string; expiresAt: number }, NotFound | RemoteUnreachable>;
  readonly listeners: Effect.Effect<void>[];
}

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

function createWorld(dataDir = createTempDir()): World {
  return {
    dataDir,
    grants: [KAI_GRANT],
    opens: [],
    connects: [],
    links: [],
    next: [],
    connect: () => Effect.succeed({ url: 'wss://kai/remote?token=t', expiresAt: 1 }),
    listeners: [],
  };
}

async function startRelay(world: World, file: Partial<RemoteFile> = PAIRED) {
  const observe = (listener: Effect.Effect<void>) => Effect.sync(() => void world.listeners.push(listener));
  const stubs = Layer.mergeAll(
    Layer.succeed(TeamFeeds, {
      listGrants: Effect.sync(() => world.grants),
      observe,
    } as unknown as TeamFeeds['Service']),
    Layer.succeed(Remote, { machineName: 'Studio', observe } as unknown as Remote['Service']),
    Layer.succeed(RemoteClient, {
      teams: {
        remoteConnect: (token: Redacted.Redacted<string>, teamId: string, instanceId: string) => {
          world.connects.push({ token: Redacted.value(token), teamId, instanceId });
          return world.connect();
        },
      },
    } as unknown as RemoteClient['Service']),
    Layer.succeed(DeviceChannels, {
      open: (options) => {
        world.opens.push(options);
        const opened = world.next.shift() ?? createLink();
        if (opened instanceof DeviceChannelError) return Effect.fail(opened);
        world.links.push(opened);
        return Effect.succeed(opened.link);
      },
    })
  );
  const storeLayer = RemoteStore.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EngineConfig, { dataDir: world.dataDir } as ServerConfig),
        JsonFileLayer,
        JsonLogger
      )
    )
  );
  const scope = Effect.runSync(Scope.make());
  const context = (await Effect.runPromise(
    Layer.buildWithScope(
      FleetRelay.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(storeLayer, stubs)),
        Layer.provideMerge(JsonLogger)
      ),
      scope
    )
  )) as Context.Context<FleetRelay | RemoteStore>;
  const store = Context.get(context, RemoteStore);
  await Effect.runPromise(store.update((before) => ({ ...before, ...file })));
  const relay = Context.get(context, FleetRelay);
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect);
  const stop = () => Effect.runPromise(Scope.close(scope, Exit.void));
  running.push(stop);
  return {
    relay,
    store,
    stop,
    list: () => run(relay.list),
    request: (instanceId: string, path: string, init?: RequestInit, url = `http://localhost${path}`) =>
      run(relay.request(instanceId, path, new Request(url, init))),
    file: () => Effect.runSync(store.file),
    update: (change: (file: RemoteFile) => RemoteFile) => run(store.update(change)),
    sync: () => run(Effect.forEach(world.listeners, (listener) => listener, { discard: true })),
  };
}

function createPeer() {
  const peer = {
    sent: [] as string[],
    closes: [] as [number, string][],
    send: (data: string | Uint8Array) => {
      peer.sent.push(String(data));
    },
    close: (code: number, reason: string) => {
      peer.closes.push([code, reason]);
    },
  };
  return peer;
}

async function readText(response: Response) {
  return [response.status, await response.text()] as const;
}

async function readFailure(response: Response) {
  return [response.status, ((await response.json()) as { error: { code: string; message: string } }).error];
}

async function createStoredDevice(overrides: Partial<RelayDevice> = {}): Promise<RelayDevice> {
  const keys = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    instanceId: 'kai-mac',
    teamId: 'team1',
    machineKey: 'kai-key',
    publicKey: await Effect.runPromise(serializePublicKey(keys.publicKey)),
    privateKey: await Effect.runPromise(serializePrivateKey(keys.privateKey)),
    enrolledAt: 1,
    ...overrides,
  };
}

describe('the relay list', () => {
  test('names every teammate machine this machine can reach as a device, and none while remote access is off', async () => {
    const world = createWorld();
    world.grants = [
      KAI_GRANT,
      { teamId: 'team1', machine: LEE_MAC, machineKey: 'lee-key', grant: null },
      { teamId: 'team2', machine: KAI_MAC, machineKey: 'kai-key', grant: 'second' },
    ];
    const relay = await startRelay(world);
    expect(await relay.list()).toEqual([
      {
        instanceId: 'kai-mac',
        teamId: 'team1',
        name: 'Kai’s Mac',
        userId: '7',
        appOrigin: REMOTE_APP_ORIGIN,
      },
    ]);
    await relay.update((file) => ({
      ...file,
      relayDevices: [{ ...KAI_DEVICE, instanceId: 'lee-mac', machineKey: 'lee-key' }],
    }));
    expect((await relay.list()).map((entry) => entry.instanceId)).toEqual(['kai-mac', 'lee-mac']);
    await relay.update((file) => ({ ...file, enabled: false }));
    expect(await relay.list()).toEqual([]);
  });

  test('takes the team whose grant it has when a machine is in two teams', async () => {
    const world = createWorld();
    world.grants = [{ ...KAI_GRANT, teamId: 'team0', grant: null }, KAI_GRANT];
    expect((await (await startRelay(world)).list()).map((entry) => entry.teamId)).toEqual(['team1']);
  });
});

describe('a request to a teammate’s machine', () => {
  test('enrols this machine’s own device with the grant once, keeps its keys, and relays every request on one channel', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const answer = await relay.request(
      'kai-mac',
      '/api/tasks/SW-1',
      {
        headers: {
          accept: 'application/json',
          cookie: 'c',
          origin: 'http://localhost',
          'sec-fetch-site': 'same-origin',
        },
      },
      'http://localhost/api/teams/relay/kai-mac/api/tasks/SW-1?full=1'
    );
    expect(await readText(answer)).toEqual([200, 'answer /api/tasks/SW-1?full=1']);
    expect(world.connects).toEqual([{ token: 'studio-token', teamId: 'team1', instanceId: 'kai-mac' }]);
    expect(world.opens).toEqual([
      {
        url: 'wss://kai/remote?token=t',
        origin: expect.any(String),
        machineKey: 'kai-key',
        device: expect.anything(),
        enrollSecret: 'kai-grant',
        name: 'Studio',
      },
    ]);
    expect(world.links[0]?.requests[0]).toMatchObject({
      method: 'GET',
      headers: [['accept', 'application/json']],
      body: null,
    });
    const kept = relay.file().relayDevices;
    expect(kept).toEqual([
      expect.objectContaining({ instanceId: 'kai-mac', teamId: 'team1', machineKey: 'kai-key' }),
    ]);
    const sent = await relay.request('kai-mac', '/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"type":"task.retry"}',
    });
    expect(sent.status).toBe(200);
    world.links[0]?.emit('{"t":"state"}');
    expect(world.opens).toHaveLength(1);
    expect(new TextDecoder().decode(world.links[0]?.requests[1]?.body ?? new Uint8Array())).toBe(
      '{"type":"task.retry"}'
    );
    const empty = await relay.request('kai-mac', '/api/commands', { method: 'POST' });
    expect(empty.status).toBe(200);
    expect(world.links[0]?.requests[2]?.body).toBeNull();
  });

  test('comes back as the device it enrolled after a restart, without the grant', async () => {
    const world = createWorld();
    const stored = await createStoredDevice();
    const relay = await startRelay(world, { ...PAIRED, relayDevices: [stored] });
    expect((await relay.request('kai-mac', '/api/health')).status).toBe(200);
    expect(world.opens.map((open) => open.enrollSecret)).toEqual([null]);
    expect(relay.file().relayDevices).toEqual([stored]);
  });

  test('enrols again when its device was refused, its keys are unreadable, or the machine’s key changed', async () => {
    const world = createWorld();
    world.next = [new DeviceChannelError({ message: 'Not this device.', refused: true })];
    const refused = await startRelay(world, { ...PAIRED, relayDevices: [await createStoredDevice()] });
    expect((await refused.request('kai-mac', '/api/health')).status).toBe(200);
    expect(world.opens.map((open) => open.enrollSecret)).toEqual([null, 'kai-grant']);
    const broken = createWorld();
    const unreadable = await startRelay(broken, { ...PAIRED, relayDevices: [{ ...KAI_DEVICE }] });
    expect((await unreadable.request('kai-mac', '/api/health')).status).toBe(200);
    expect(broken.opens.map((open) => open.enrollSecret)).toEqual(['kai-grant']);
    expect(unreadable.file().relayDevices[0]?.publicKey).not.toBe('pk');
    const moved = createWorld();
    const repaired = await startRelay(moved, {
      ...PAIRED,
      relayDevices: [await createStoredDevice({ machineKey: 'old-key' })],
    });
    expect((await repaired.request('kai-mac', '/api/health')).status).toBe(200);
    expect(moved.opens.map((open) => open.enrollSecret)).toEqual(['kai-grant']);
    expect(repaired.file().relayDevices[0]?.machineKey).toBe('kai-key');
  });

  test('opens a new channel once the last one closed', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    await relay.request('kai-mac', '/api/health');
    world.links[0]?.drop(new DeviceChannelError({ message: 'Gone.', refused: false }));
    await relay.request('kai-mac', '/api/health');
    expect(world.opens).toHaveLength(2);
  });

  test('says why it cannot reach the machine, in the engine’s own failure shape', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    expect(await readFailure(await relay.request('nobody', '/api/health'))).toEqual([
      403,
      { code: 'relay_refused', message: FLEET_RELAY_MESSAGES.unknown },
    ]);
    world.next = [new DeviceChannelError({ message: DEVICE_CHANNEL_MESSAGES.unreachable, refused: false })];
    expect(await readFailure(await relay.request('kai-mac', '/api/health'))).toEqual([
      502,
      { code: 'relay_failed', message: DEVICE_CHANNEL_MESSAGES.unreachable },
    ]);
    world.connect = () => Effect.fail(new NotFound({ message: 'No such machine.' }));
    expect(await readFailure(await relay.request('kai-mac', '/api/health'))).toEqual([
      403,
      { code: 'relay_refused', message: 'No such machine.' },
    ]);
    world.connect = () =>
      Effect.fail(
        new RemoteUnreachable({ endpoint: 'x', status: null, retryable: true, message: 'Offline.' })
      );
    expect((await relay.request('kai-mac', '/api/health')).status).toBe(502);
  });

  test('keeps a stored device when its channel fails for any reason but a refusal', async () => {
    const world = createWorld();
    world.next = [new DeviceChannelError({ message: 'Timed out.', refused: false })];
    const relay = await startRelay(world, { ...PAIRED, relayDevices: [await createStoredDevice()] });
    expect((await relay.request('kai-mac', '/api/health')).status).toBe(502);
    expect(relay.file().relayDevices).toHaveLength(1);
  });

  test('refuses without a grant to enrol with, or while remote access is off', async () => {
    const world = createWorld();
    world.grants = [{ ...KAI_GRANT, grant: null }];
    expect(await readFailure(await (await startRelay(world)).request('kai-mac', '/api/health'))).toEqual([
      403,
      { code: 'relay_refused', message: FLEET_RELAY_MESSAGES.refused },
    ]);
    const off = createWorld();
    expect(
      await readFailure(
        await (await startRelay(off, { ...PAIRED, enabled: false })).request('kai-mac', '/api/health')
      )
    ).toEqual([403, { code: 'relay_refused', message: FLEET_RELAY_MESSAGES.unpaired }]);
    const unpaired = createWorld();
    expect(
      await readFailure(
        await (await startRelay(unpaired, { ...PAIRED, credentials: null })).request('kai-mac', '/api/health')
      )
    ).toEqual([403, { code: 'relay_refused', message: FLEET_RELAY_MESSAGES.unpaired }]);
  });

  test('closes the new channel and says so when it cannot keep or forget a device', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const path = join(world.dataDir, 'remote.json');
    rmSync(path);
    mkdirSync(path);
    expect((await relay.request('kai-mac', '/api/health')).status).toBe(502);
    expect(world.links[0]?.closed).toBe(true);
    const refused = createWorld();
    refused.next = [new DeviceChannelError({ message: 'Not this device.', refused: true })];
    const stored = await startRelay(refused, { ...PAIRED, relayDevices: [await createStoredDevice()] });
    const storedPath = join(refused.dataDir, 'remote.json');
    rmSync(storedPath);
    mkdirSync(storedPath);
    expect((await stored.request('kai-mac', '/api/health')).status).toBe(502);
  });

  test('answers an aborted request with no body', async () => {
    const world = createWorld();
    world.next = [
      createLink(() => Effect.fail(new DeviceRequestAborted({ message: DEVICE_CHANNEL_MESSAGES.aborted }))),
    ];
    expect((await (await startRelay(world)).request('kai-mac', '/api/health')).status).toBe(499);
  });

  test('refuses a body over the engine’s request limit, declared or read, before it reaches the machine', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const declared = await relay.request('kai-mac', '/api/commands', {
      method: 'POST',
      headers: { 'content-length': String(RELAY_BODY_LIMIT_BYTES + 1) },
      body: 'x',
    });
    expect(await readFailure(declared)).toEqual([
      413,
      { code: 'body_too_large', message: describeBodyLimit(RELAY_BODY_LIMIT_BYTES) },
    ]);
    const read = await relay.request('kai-mac', '/api/commands', {
      method: 'POST',
      body: new Uint8Array(RELAY_BODY_LIMIT_BYTES + 1),
    });
    expect(read.status).toBe(413);
    expect(world.links).toEqual([]);
  });

  test('answers a body the page stopped sending with no body, as an aborted request', async () => {
    const world = createWorld();
    const broken = new ReadableStream({
      start: (controller) => controller.error(new Error('gone')),
    });
    const answer = await (
      await startRelay(world)
    ).request('kai-mac', '/api/commands', {
      method: 'POST',
      body: broken,
    });
    expect(answer.status).toBe(499);
    expect(world.links).toEqual([]);
  });
});

describe('a page socket to a teammate’s machine', () => {
  test('relays the app socket both ways on a channel of its own, and closes it when the page leaves', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const peer = createPeer();
    const socket = await Effect.runPromise(relay.relay.openSocket('kai-mac', peer as ChannelPeer));
    await until('the channel opens', () => world.links.length === 1);
    const link = world.links[0] as FakeLink;
    link.emit('{"t":"state"}');
    await Effect.runPromise(socket.receive('{"t":"hello"}'));
    await Effect.runPromise(socket.receive(new TextEncoder().encode('{"t":"command"}')));
    await until('both messages reach the machine', () => link.sent.length === 2);
    await until('the machine’s message reaches the page', () => peer.sent.length === 1);
    expect(peer.sent).toEqual(['{"t":"state"}']);
    expect(link.sent).toEqual(['{"t":"hello"}', '{"t":"command"}']);
    await Effect.runPromise(socket.close);
    await until('the channel closes', () => link.closed);
    expect(peer.closes).toEqual([]);
  });

  test('closes the page’s socket with the reason the channel ended, or why it never opened', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const dropped = createPeer();
    await Effect.runPromise(relay.relay.openSocket('kai-mac', dropped as ChannelPeer));
    await until('the relay watches the channel', () => world.links[0]?.isWatched() === true);
    world.links[0]?.drop(new DeviceChannelError({ message: 'Broke.', refused: false }));
    await until('the page is told', () => dropped.closes.length === 1);
    expect(dropped.closes).toEqual([[RELAY_CLOSE.broke, 'Broke.']]);
    const unknown = createPeer();
    await Effect.runPromise(relay.relay.openSocket('nobody', unknown as ChannelPeer));
    await until('the page is told', () => unknown.closes.length === 1);
    expect(unknown.closes).toEqual([[RELAY_CLOSE.refused, FLEET_RELAY_MESSAGES.unknown]]);
  });

  test('ends when a message no longer reaches the machine', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    const peer = createPeer();
    const socket = await Effect.runPromise(relay.relay.openSocket('kai-mac', peer as ChannelPeer));
    await until('the channel opens', () => world.links.length === 1);
    (world.links[0] as FakeLink).closed = true;
    await Effect.runPromise(socket.receive('{"t":"hello"}'));
    await until('the page is told', () => peer.closes.length === 1);
    expect(peer.closes).toEqual([[RELAY_CLOSE.broke, DEVICE_CHANNEL_MESSAGES.closed]]);
  });
});

describe('when access ends', () => {
  test('closes the channels of a machine it no longer reaches, but keeps its device while the team lists it', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    await relay.request('kai-mac', '/api/health');
    const peer = createPeer();
    await Effect.runPromise(relay.relay.openSocket('kai-mac', peer as ChannelPeer));
    await until('both channels open', () => world.links.length === 2);
    world.grants = [];
    await relay.sync();
    expect(world.links.every((link) => link.closed)).toBe(true);
    expect(peer.closes).toEqual([[RELAY_CLOSE.refused, FLEET_RELAY_MESSAGES.unknown]]);
    expect(relay.file().relayDevices).toHaveLength(1);
  });

  test('forgets the device once the machine says it has no grant, leaves the team, or remote access is off', async () => {
    const world = createWorld();
    const relay = await startRelay(world, {
      ...PAIRED,
      relayDevices: [KAI_DEVICE, { ...KAI_DEVICE, instanceId: 'lee-mac' }],
    });
    await relay.sync();
    expect(relay.file().relayDevices).toHaveLength(2);
    world.grants = [{ ...KAI_GRANT, grant: null }];
    await relay.sync();
    expect(relay.file().relayDevices.map((device) => device.instanceId)).toEqual(['lee-mac']);
    await relay.update((file) => ({ ...file, teams: [{ ...TEAM, machines: [KAI_MAC] }] }));
    await relay.sync();
    expect(relay.file().relayDevices).toEqual([]);
    await relay.update((file) => ({ ...file, relayDevices: [KAI_DEVICE], teamKeys: [] }));
    await relay.sync();
    expect(relay.file().relayDevices).toEqual([]);
    await relay.update((file) => ({
      ...file,
      relayDevices: [KAI_DEVICE],
      teamKeys: PAIRED.teamKeys ?? [],
      enabled: false,
    }));
    world.grants = [KAI_GRANT];
    await relay.sync();
    expect(relay.file().relayDevices).toEqual([]);
  });

  test('logs a device it could not forget and carries on', async () => {
    const world = createWorld();
    const relay = await startRelay(world, { ...PAIRED, relayDevices: [KAI_DEVICE] });
    world.grants = [{ ...KAI_GRANT, grant: null }];
    const path = join(world.dataDir, 'remote.json');
    rmSync(path);
    mkdirSync(path);
    const logs = captureLogs();
    await relay.sync();
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not forget a teammate machine’s relay device')).toHaveLength(1);
  });

  test('closes every channel when the engine stops', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    await relay.request('kai-mac', '/api/health');
    await relay.stop();
    expect(world.links[0]?.closed).toBe(true);
  });
});

describe('where the relay keeps its keys', () => {
  test('only in this machine’s remote.json', async () => {
    const world = createWorld();
    const relay = await startRelay(world);
    await relay.request('kai-mac', '/api/health');
    const text = await Bun.file(join(world.dataDir, 'remote.json')).text();
    const device = relay.file().relayDevices[0];
    expect(device && text.includes(device.publicKey)).toBe(true);
  });
});
