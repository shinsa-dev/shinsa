import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createTeamWelcome,
  DEFAULT_TEAM_SCOPES,
  parseShareMessage,
  parseTeamHello,
  REMOTE_KEY_ALGORITHM,
  type RemoteTeam,
  resolveMachineTeamPath,
  type ShareMessage,
  SIGNING_KEY_ALGORITHM,
  serializeBase64Url,
  serializePublicKey,
  signTeamSnapshot,
  TEAM_SNAPSHOT_TTL_MS,
  type TeamMachine,
  type TeamSnapshot,
  type TeamTask,
  TEAM_REFUSALS,
} from '@shinsa/core';
import { NotFound } from '@shinsa/core/remote/errors';
import { Clock, Effect, Layer, Option } from 'effect';
import { EgressGate } from '../../src/remote/egress/service.ts';
import {
  type FeedSocket,
  TEAM_FEED_OFFLINE,
  TEAM_FEED_REFUSED,
  TEAM_VIEW_GONE,
  TeamFeedSettings,
} from '../../src/remote/team-feeds/schema.ts';
import { TEAM_SNAPSHOTS_FILE } from '../../src/remote/team-snapshots/schema.ts';
import { TEAM_VIEWS_DIR } from '../../src/remote/team-views/schema.ts';
import { createFixedClock } from '../helpers/clock.ts';
import { until } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createRepo, createShareView, createStubEngine, createTask, readSentView } from '../helpers/state.ts';
import { type FakeControlPlane, refuse, startFakeControlPlane } from './control-plane.ts';
import {
  adaptRemote,
  adaptTeamFeeds,
  adaptTeams,
  createRemoteTest,
  type RemoteTestOptions,
} from './harness.ts';
import { openTeamViews } from './kept.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: null, avatarUrl: null };

const TEAM_KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(4));

const STUDIO: TeamMachine = { id: 'inst1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: 1 };

const LAPTOP: TeamMachine = { id: 'inst2', name: 'Laptop', userId: KAI.id, online: true, lastSeenAt: 1 };

const CONNECT_PATH = resolveMachineTeamPath('team1', 'connect');

function createTeam(overrides: Partial<RemoteTeam> = {}): RemoteTeam {
  return {
    id: 'team1',
    name: 'Platform',
    owner: MONA,
    role: 'owner',
    members: [{ user: KAI, addedAt: 2 }],
    requests: [],
    machines: [STUDIO, LAPTOP],
    scopes: DEFAULT_TEAM_SCOPES,
    overrides: [],
    createdAt: 1,
    ...overrides,
  };
}

function createKey(key = TEAM_KEY) {
  return { teamId: 'team1', name: 'Platform', key, invite: null, addedAt: 1 };
}

let running: FakeControlPlane | null = null;

afterEach(async () => {
  await running?.stop();
  running = null;
});

async function createMachine(
  plane: FakeControlPlane,
  file: Record<string, unknown>,
  options: RemoteTestOptions = {}
) {
  const machine = await createRemoteTest({
    file: { enabled: true, ...file },
    origin: plane.origin,
    engine: createStubEngine().engine.core,
    ...options,
  });
  return { machine, remote: adaptRemote(machine) };
}

function fixClock(now: () => number) {
  return Layer.succeed(Clock.Clock, createFixedClock(now));
}

function credentials(instanceId: string) {
  return {
    instanceId,
    machineToken: `${instanceId}-token`,
    connectKey: 'key',
  };
}

function toArrayBuffer(data: string | Uint8Array) {
  return typeof data === 'string' ? data : data.slice().buffer;
}

interface FakeFeedSocket extends FeedSocket {
  url: string;
  origin: string;
  drop: () => void;
}

interface SetUp {
  studioFile?: Record<string, unknown>;
  viewer?: string;
  watcherKey?: string;
  watcherFile?: Record<string, unknown>;
  watcherMachines?: TeamMachine[];
  held?: TeamSnapshot[];
  now?: () => number;
  live?: unknown;
}

interface Restart {
  now?: () => number;
  createSocket?: (url: string, origin: string) => FeedSocket;
}

function createWait(waits: (() => void)[]) {
  return () =>
    Effect.callback<void>((resume) => {
      const run = () => resume(Effect.void);
      waits.push(run);
      return Effect.sync(() => {
        const at = waits.indexOf(run);
        if (at >= 0) waits.splice(at, 1);
      });
    });
}

async function setUp(options: SetUp = {}) {
  const plane = startFakeControlPlane();
  running = plane;
  plane.answers.set(CONNECT_PATH, () =>
    Response.json({ url: 'wss://t-inst1.shinsa.dev/team?token=t', expiresAt: 1 })
  );
  const stub = createStubEngine((state) => {
    state.projects.p1 = {
      id: 'p1',
      name: 'Superwall',
      color: 'blue',
      key: 'SW',
      description: '',
      folders: [],
      teamIds: ['team1'],
    };
    state.repos['repo-1'] = createRepo({ projectId: 'p1' });
    state.tasks['task-1'] = createTask({ repoId: 'repo-1', activity: [] });
    state.tasks['task-2'] = createTask({ id: 'task-2', repoId: 'repo-1', stage: 'merged', activity: [] });
  });
  const live = { view: createShareView({ title: 'Live' }), files: [] };
  const studioMachine = await createMachine(
    plane,
    {
      credentials: credentials('inst1'),
      owner: 'mona',
      access: { owner: MONA, members: [] },
      teams: [createTeam()],
      teamKeys: [createKey()],
      ...options.studioFile,
    },
    {
      engine: stub.engine.core,
      shares: (shares) => ({
        ...shares,
        resolveLive: () => Effect.succeed((options.live ?? live) as never),
      }),
      teamFeeds: (held) => ({
        ...held,
        listHeld: () => Effect.succeed(options.held ?? []),
        observeHeld: () => Effect.void,
      }),
      layers: fixClock(() => 50),
    }
  );
  const studio = studioMachine.remote;
  const teams = adaptTeams(studioMachine.machine);
  const sockets: FakeFeedSocket[] = [];
  const waits: (() => void)[] = [];
  const viewWaits: (() => void)[] = [];
  const createSocket = (url: string, origin: string) => {
    const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {
      open: [],
      message: [],
      close: [],
    };
    let closed = false;
    const emit = (type: string, data?: unknown) => {
      for (const listener of listeners[type] ?? []) listener({ data });
    };
    const channel = teams.openChannel(
      {
        send: (data) => queueMicrotask(() => !closed && emit('message', toArrayBuffer(data))),
        close: () =>
          queueMicrotask(() => {
            if (closed) return;
            closed = true;
            emit('close');
          }),
      },
      options.viewer ?? KAI.id
    );
    const socket: FakeFeedSocket = {
      url,
      origin,
      binaryType: '',
      send: (data) => void channel.receive(data),
      close: () => {
        if (closed) return;
        closed = true;
        teams.closeChannel(channel);
      },
      addEventListener: (type, listener) => listeners[type]?.push(listener),
      drop: () => {
        closed = true;
        teams.closeChannel(channel);
        emit('close');
      },
    };
    sockets.push(socket);
    queueMicrotask(() => emit('open'));
    return socket;
  };
  const laptopFile = {
    credentials: credentials('inst2'),
    owner: 'kai',
    access: { owner: KAI, members: [] },
    teams: [
      createTeam({
        role: 'member',
        ...(options.watcherMachines ? { machines: options.watcherMachines } : {}),
      }),
    ],
    teamKeys: [createKey(options.watcherKey)],
    ...options.watcherFile,
  };
  const laptopMachine = await createMachine(plane, laptopFile, {
    layers: Layer.merge(
      fixClock(options.now ?? (() => 60)),
      Layer.succeed(TeamFeedSettings, {
        createSocket,
        wait: createWait(waits),
        waitForViews: createWait(viewWaits),
      })
    ),
  });
  const laptop = laptopMachine.remote;
  const feeds = adaptTeamFeeds(laptopMachine.machine);
  const restart = async (restarted: Restart = {}) => {
    const again = await createRemoteTest({
      dataDir: dirname(laptop.store.path),
      origin: plane.origin,
      engine: createStubEngine().engine.core,
      layers: Layer.merge(
        restarted.now ? fixClock(restarted.now) : Layer.empty,
        restarted.createSocket
          ? Layer.succeed(TeamFeedSettings, {
              createSocket: restarted.createSocket,
              wait: Effect.sleep,
              waitForViews: Effect.sleep,
            })
          : Layer.empty
      ),
    });
    return adaptTeamFeeds(again);
  };
  return {
    plane,
    stub,
    studio,
    studioMachine: studioMachine.machine,
    laptop,
    teams,
    feeds,
    sockets,
    waits,
    viewWaits,
    restart,
  };
}

type Feeds = Awaited<ReturnType<typeof setUp>>['feeds'];

type Remote = Awaited<ReturnType<typeof setUp>>['laptop'];

function listMachineStatus(feeds: Feeds) {
  return feeds.snapshot().machines.map((machine) => [machine.instanceId, machine.status, machine.reason]);
}

describe('watching teammates’ machines', () => {
  test('lists a teammate’s team tasks with the team and machine, leaving this machine out', async () => {
    const { feeds, sockets, plane } = await setUp();
    const changes: number[] = [];
    const unsubscribe = feeds.subscribe(() => changes.push(1));
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    expect(sockets.map((socket) => [socket.url, socket.origin])).toEqual([
      ['wss://t-inst1.shinsa.dev/team?token=t', plane.origin],
    ]);
    expect(plane.calls.find((call) => call.path === CONNECT_PATH)).toMatchObject({
      token: 'inst2-token',
      body: { instanceId: 'inst1' },
    });
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'live', null]]);
    expect(feeds.listGrants()).toEqual([
      { teamId: 'team1', machine: STUDIO, machineKey: expect.any(String), grant: expect.any(String) },
    ]);
    expect(feeds.snapshot().tasks[0]).toMatchObject({
      teamId: 'team1',
      instanceId: 'inst1',
      owner: 'mona',
      task: { id: 'task-1' },
    });
    await until('the list is published', () => changes.length > 1);
    expect(feeds.listTasks({ open: true }).map((task) => task.task.id)).toEqual(['task-1']);
    expect(feeds.listTasks({ teamId: 'other' })).toEqual([]);
    unsubscribe();
    feeds.subscribeHeld(() => undefined)();
    const heard = changes.length;
    await feeds.sync();
    expect(changes).toHaveLength(heard);
    await feeds.stop();
  });

  test('follows the teammate’s machine as it changes, and keeps its last list while it is offline', async () => {
    const { feeds, stub, laptop, sockets } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    stub.state.tasks['task-3'] = createTask({ id: 'task-3', repoId: 'repo-1', activity: [] });
    stub.notify();
    await until('the new task arrives', () => feeds.snapshot().tasks.length === 3);
    await laptop.store.recordTeams([
      createTeam({ role: 'member', machines: [{ ...STUDIO, online: false }, LAPTOP] }),
    ]);
    expect(feeds.listGrants()).toHaveLength(1);
    await laptop.publish();
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    expect(feeds.listGrants()).toEqual([]);
    expect(feeds.snapshot().machines[0]?.updatedAt).toBe(50);
    expect(
      feeds
        .snapshot()
        .tasks.map((task) => task.task.id)
        .sort()
    ).toEqual(['task-1', 'task-2', 'task-3']);
    await laptop.store.recordTeams([createTeam({ role: 'member' })]);
    await laptop.publish();
    await until('it connects again', () => feeds.snapshot().machines[0]?.status === 'live');
    expect(sockets).toHaveLength(2);
    await feeds.stop();
  });

  test('tries again after a dropped channel, and starts over once live', async () => {
    const { feeds, sockets, waits } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    expect(feeds.snapshot().machines[0]?.presence).toEqual([
      { userId: MONA.id, status: 'away', seenAt: null },
    ]);
    sockets[0]?.drop();
    await until('the drop is seen', () => waits.length === 1);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    expect(feeds.snapshot().machines[0]?.presence).toBeUndefined();
    expect(feeds.snapshot().tasks).toHaveLength(2);
    waits.shift()?.();
    await until('it is live again', () => feeds.snapshot().machines[0]?.status === 'live');
    expect(sockets).toHaveLength(2);
    await feeds.stop();
  });

  test('tries a refusing machine again only after a long wait, and at once with a new key', async () => {
    const { feeds, laptop, sockets, waits } = await setUp({ watcherKey: OTHER_KEY });
    await feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'refused', TEAM_REFUSALS.mismatch]]);
    expect(feeds.listGrants()).toEqual([]);
    expect(waits).toHaveLength(1);
    await laptop.publish();
    expect(sockets).toHaveLength(1);
    waits.shift()?.();
    await until('it is refused again', () => sockets.length === 2 && waits.length === 1);
    await laptop.store.upsertTeamKey(createKey());
    await laptop.publish();
    await until('it is live with the new key', () => feeds.snapshot().tasks.length === 2);
    await feeds.stop();
  });

  test('is refused when app.shinsa.dev says the machine is not in the team', async () => {
    const { feeds, plane } = await setUp();
    plane.answers.set(CONNECT_PATH, () => refuse(NotFound));
    await feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'refused', TEAM_FEED_REFUSED]]);
    await feeds.stop();
  });

  test('a new member refused before the teammate’s machine heard of them gets in on the next try', async () => {
    const { feeds, plane, waits } = await setUp();
    plane.answers.set(CONNECT_PATH, () => refuse(NotFound));
    await feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    plane.answers.set(CONNECT_PATH, () =>
      Response.json({ url: 'wss://t-inst1.shinsa.dev/team?token=t', expiresAt: 1 })
    );
    waits.shift()?.();
    await until('it is live', () => feeds.snapshot().tasks.length === 2);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'live', null]]);
    await feeds.stop();
  });

  test('waits and tries again when app.shinsa.dev cannot be reached', async () => {
    const { feeds, plane, waits } = await setUp();
    plane.answers.set(CONNECT_PATH, () => new Response('down', { status: 502 }));
    await feeds.start();
    await until('it waits', () => waits.length === 1);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    await feeds.stop();
    expect(waits).toEqual([]);
  });

  test('watches nothing without remote access, a key or a pairing', async () => {
    const off = await setUp({ watcherFile: { enabled: false } });
    await off.feeds.start();
    expect(off.feeds.snapshot()).toEqual({ machines: [], tasks: [] });
    const keyless = await setUp({ watcherFile: { teamKeys: [] } });
    await keyless.feeds.start();
    expect(keyless.feeds.snapshot().machines).toEqual([]);
    const { feeds, laptop } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await laptop.store.removeTeam('team1');
    await laptop.publish();
    expect(feeds.snapshot()).toEqual({ machines: [], tasks: [] });
  });
});

function readKeptFile(feedsPath: string) {
  if (!existsSync(feedsPath)) return null;
  return JSON.parse(readFileSync(feedsPath, 'utf8')) as {
    lists: {
      teamId: string;
      instanceId: string;
      updatedAt: number;
      snapshot: TeamSnapshot | null;
      initiatives?: unknown[];
    }[];
  };
}

function resolveKeptPath(remote: Remote) {
  return join(dirname(remote.store.path), TEAM_SNAPSHOTS_FILE);
}

const OFFLINE_STUDIO = { ...STUDIO, online: false };

async function createSigner() {
  const pair = (await crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    signingKey: await Effect.runPromise(serializePublicKey(pair.publicKey)),
  };
}

function createHeldTask(id: string): TeamTask {
  return { owner: 'lee', machine: 'Desk', task: { id } } as unknown as TeamTask;
}

function watchPublished(feeds: Feeds, predicate: () => boolean) {
  let published = false;
  const stop = feeds.subscribe(() => {
    published ||= predicate();
  });
  return async (awaited: string) => {
    await until(awaited, () => published);
    stop();
  };
}

async function releaseWait(waits: (() => void)[]) {
  await until('the fetch waits', () => waits.length > 0);
  waits.shift()?.();
}

describe('a teammate’s initiatives', () => {
  test('lists the initiatives a teammate shared, keeps them signed and shows them after a restart', async () => {
    const { feeds, stub, laptop, restart } = await setUp();
    stub.state.tasks['task-1'] = { ...stub.state.tasks['task-1'], initiativeId: 'chat' } as never;
    stub.state.initiatives = {
      chat: {
        id: 'chat',
        name: 'Chat split',
        description: 'Split the chat.',
        phases: [{ id: 'p-1', name: 'Session' }],
        leadTaskId: 'task-1',
        createdAt: 1,
        updatedAt: 2,
        teamIds: ['team1'],
        report: { narrative: 'Halfway.', runId: 'run-secret', at: 3 },
      },
    };
    const kept = watchPublished(feeds, () => (feeds.snapshot().initiatives ?? []).length === 1);
    await feeds.start();
    await kept('the initiative arrives');
    expect(feeds.snapshot().initiatives).toEqual([
      {
        id: 'chat',
        name: 'Chat split',
        description: 'Split the chat.',
        phases: [{ id: 'p-1', name: 'Session' }],
        leadTaskId: 'task-1',
        report: { narrative: 'Halfway.', at: 3 },
        finished: false,
        updatedAt: 2,
        teamId: 'team1',
        instanceId: 'inst1',
      },
    ]);
    expect(readKeptFile(resolveKeptPath(laptop))?.lists[0]?.initiatives).toHaveLength(1);
    await feeds.stop();
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    const restarted = await restart({ now: () => 60 });
    await restarted.start();
    expect(restarted.snapshot().initiatives?.map((initiative) => initiative.id)).toEqual(['chat']);
    await restarted.stop();
  });

  test('takes a teammate’s initiatives from a copy their machine signed', async () => {
    const desk = await createSigner();
    const initiative = {
      id: 'desk-plan',
      name: 'Desk plan',
      description: '',
      phases: [],
      leadTaskId: 'desk-1',
      report: null,
      finished: false,
      updatedAt: 1,
    };
    const body = {
      teamId: 'team1',
      instanceId: 'inst3',
      tasks: [createHeldTask('desk-1')],
      initiatives: [initiative],
      updatedAt: 40,
    };
    const signed = await Effect.runPromise(signTeamSnapshot(desk.privateKey, body));
    const desktop: TeamMachine = {
      id: 'inst3',
      name: 'Desk',
      userId: '9',
      online: false,
      lastSeenAt: 1,
      signingKey: desk.signingKey,
    };
    const { feeds } = await setUp({ watcherMachines: [STUDIO, LAPTOP, desktop], held: [signed] });
    await feeds.start();
    await until('the kept initiative is taken', () =>
      (feeds.snapshot().initiatives ?? []).some((entry) => entry.instanceId === 'inst3')
    );
    expect(feeds.snapshot().initiatives).toEqual([{ ...initiative, teamId: 'team1', instanceId: 'inst3' }]);
    await feeds.stop();
  });
});

describe('keeping a teammate’s last list', () => {
  test('keeps it on disk, signed, and shows it after a restart while the machine is offline', async () => {
    const { feeds, laptop, restart } = await setUp();
    const listKept = watchPublished(feeds, () => feeds.snapshot().tasks.length === 2);
    await feeds.start();
    await listKept('the list is kept');
    const kept = readKeptFile(resolveKeptPath(laptop));
    expect(kept?.lists.map((list) => [list.teamId, list.instanceId, list.updatedAt])).toEqual([
      ['team1', 'inst1', 50],
    ]);
    expect(kept?.lists[0]?.snapshot?.signature).toEqual(expect.any(String));
    await feeds.stop();
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    const restarted = await restart({ now: () => 60 });
    await restarted.start();
    expect(restarted.snapshot().machines).toEqual([
      expect.objectContaining({ instanceId: 'inst1', status: 'offline', updatedAt: 50 }),
    ]);
    expect(restarted.snapshot().tasks).toHaveLength(2);
    expect(restarted.listHeld('team1')).toHaveLength(1);
    expect(restarted.listHeld('other')).toEqual([]);
    await restarted.stop();
  });

  test('drops it after 30 days, and when the team key changes', async () => {
    const { feeds, laptop, restart } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await feeds.stop();
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    const late = await restart({ now: () => 51 + TEAM_SNAPSHOT_TTL_MS });
    await late.start();
    expect(late.snapshot().tasks).toEqual([]);
    expect(late.snapshot().machines[0]?.updatedAt).toBeUndefined();
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    await late.stop();
    let now = 60;
    const aging = await setUp({ now: () => now });
    await aging.feeds.start();
    await until('the list arrives', () => aging.feeds.snapshot().tasks.length === 2);
    await aging.laptop.store.recordTeams([
      createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] }),
    ]);
    await aging.laptop.publish();
    expect(aging.feeds.snapshot().tasks).toHaveLength(2);
    now = 51 + TEAM_SNAPSHOT_TTL_MS;
    expect(aging.feeds.snapshot().tasks).toEqual([]);
    expect(aging.feeds.listHeld('team1')).toEqual([]);
    await aging.feeds.stop();
    const again = await setUp();
    await again.feeds.start();
    await until('the list arrives', () => again.feeds.snapshot().tasks.length === 2);
    await again.laptop.store.recordTeams([
      createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] }),
    ]);
    await again.laptop.publish();
    expect(again.feeds.snapshot().tasks).toHaveLength(2);
    await again.laptop.store.upsertTeamKey(createKey(OTHER_KEY));
    await again.laptop.publish();
    expect(again.feeds.snapshot().tasks).toEqual([]);
    expect(readKeptFile(resolveKeptPath(again.laptop))).toBeNull();
  });

  test('drops it when the machine leaves the team or this machine leaves it, and keeps it while remote access is paused', async () => {
    const { feeds, laptop } = await setUp();
    const listKept = watchPublished(feeds, () => feeds.snapshot().tasks.length === 2);
    await feeds.start();
    await listKept('the list is kept');
    await laptop.store.update((file) => ({ ...file, enabled: false }));
    await laptop.publish();
    expect(readKeptFile(resolveKeptPath(laptop))?.lists).toHaveLength(1);
    await laptop.store.update((file) => ({ ...file, enabled: true }));
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [LAPTOP] })]);
    await laptop.publish();
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    const other = await setUp();
    const otherListKept = watchPublished(other.feeds, () => other.feeds.snapshot().tasks.length === 2);
    await other.feeds.start();
    await otherListKept('the list is kept');
    await other.laptop.store.removeTeam('team1');
    await other.laptop.publish();
    expect(readKeptFile(resolveKeptPath(other.laptop))).toBeNull();
    await other.feeds.stop();
  });

  test('drops every copy and full task once this machine is unpaired, and expired ones while paused', async () => {
    let now = 60;
    const { feeds, laptop, viewWaits } = await setUp({ live: createFullLive(), now: () => now });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await releaseWait(viewWaits);
    await until('the views are kept', async () => (await (await readKeptViews(laptop)).list()).length === 2);
    await laptop.store.update((file) => ({ ...file, enabled: false }));
    await laptop.publish();
    expect(await (await readKeptViews(laptop)).list()).toHaveLength(2);
    now = 51 + TEAM_SNAPSHOT_TTL_MS;
    await laptop.publish();
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    expect(await (await readKeptViews(laptop)).list()).toEqual([]);
    await feeds.stop();
    const other = await setUp({ live: createFullLive() });
    await other.feeds.start();
    await until('the list arrives', () => other.feeds.snapshot().tasks.length === 2);
    await releaseWait(other.viewWaits);
    await until(
      'the views are kept',
      async () => (await (await readKeptViews(other.laptop)).list()).length === 2
    );
    await other.laptop.store.update((file) => ({
      ...file,
      credentials: null,
      enabled: false,
      teams: [],
      teamKeys: [],
    }));
    await other.laptop.publish();
    expect(readKeptFile(resolveKeptPath(other.laptop))).toBeNull();
    expect(await (await readKeptViews(other.laptop)).list()).toEqual([]);
    await other.feeds.stop();
  });

  test('drops it when the teammate’s machine refuses this one', async () => {
    const { feeds, laptop, plane, sockets, waits } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    plane.answers.set(CONNECT_PATH, () => refuse(NotFound));
    sockets[0]?.drop();
    await until('the drop is seen', () => waits.length === 1);
    waits.shift()?.();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(feeds.snapshot().tasks).toEqual([]);
    expect(feeds.listHeld('team1')).toEqual([]);
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    await feeds.stop();
  });

  test('takes an offline machine’s list from a teammate only when that machine’s own key signed it', async () => {
    const desk = await createSigner();
    const forger = await createSigner();
    const body = { teamId: 'team1', instanceId: 'inst3', tasks: [createHeldTask('desk-1')], updatedAt: 40 };
    const signed = await Effect.runPromise(signTeamSnapshot(desk.privateKey, body));
    const forged = await Effect.runPromise(
      signTeamSnapshot(forger.privateKey, {
        ...body,
        tasks: [createHeldTask('fake')],
        updatedAt: 45,
      })
    );
    const elsewhere = await Effect.runPromise(
      signTeamSnapshot(desk.privateKey, { ...body, teamId: 'team2', updatedAt: 46 })
    );
    const unknown = await Effect.runPromise(
      signTeamSnapshot(desk.privateKey, { ...body, instanceId: 'inst9' })
    );
    const desktop: TeamMachine = {
      id: 'inst3',
      name: 'Desk',
      userId: '9',
      online: false,
      lastSeenAt: 1,
      signingKey: desk.signingKey,
    };
    const { feeds, laptop } = await setUp({
      watcherMachines: [STUDIO, LAPTOP, desktop],
      held: [forged, elsewhere, unknown, signed],
    });
    const heard: number[] = [];
    const stopHearing = feeds.subscribeHeld(() => heard.push(1));
    await feeds.start();
    await until('the kept list is taken', () =>
      feeds.snapshot().tasks.some((task) => task.instanceId === 'inst3')
    );
    expect(
      feeds
        .listTasks()
        .filter((task) => task.instanceId === 'inst3')
        .map((task) => task.task.id)
    ).toEqual(['desk-1']);
    expect(feeds.snapshot().machines.find((machine) => machine.instanceId === 'inst3')?.updatedAt).toBe(40);
    await until('the kept list is published', () => heard.length > 0);
    expect(feeds.listHeld('team1')).toEqual([signed]);
    stopHearing();
    expect(
      readKeptFile(resolveKeptPath(laptop))
        ?.lists.map((list) => list.instanceId)
        .sort()
    ).toEqual(['inst1', 'inst3']);
    await feeds.stop();
  });

  test('never lets an older or expired signed copy replace a newer kept one', async () => {
    const desk = await createSigner();
    const body = {
      teamId: 'team1',
      instanceId: 'inst3',
      tasks: [createHeldTask('desk-new')],
      updatedAt: 200,
    };
    const fresh = await Effect.runPromise(signTeamSnapshot(desk.privateKey, body));
    const older = await Effect.runPromise(
      signTeamSnapshot(desk.privateKey, {
        ...body,
        tasks: [createHeldTask('desk-older')],
        updatedAt: 100,
      })
    );
    const expired = await Effect.runPromise(
      signTeamSnapshot(desk.privateKey, {
        ...body,
        tasks: [createHeldTask('desk-expired')],
        updatedAt: 40,
      })
    );
    const desktop: TeamMachine = {
      id: 'inst3',
      name: 'Desk',
      userId: '9',
      online: false,
      lastSeenAt: 1,
      signingKey: desk.signingKey,
    };
    const { feeds } = await setUp({
      watcherMachines: [STUDIO, LAPTOP, desktop],
      held: [fresh, older, fresh, expired],
      now: () => 50 + TEAM_SNAPSHOT_TTL_MS,
    });
    const heard: number[] = [];
    const stopHearing = feeds.subscribeHeld(() => heard.push(1));
    await feeds.start();
    await until('every kept list is checked', () => heard.length > 0);
    stopHearing();
    await until('the teammate’s own list arrives', () =>
      feeds.snapshot().tasks.some((task) => task.instanceId === 'inst1')
    );
    expect(
      feeds
        .listTasks()
        .filter((task) => task.instanceId === 'inst3')
        .map((task) => task.task.id)
    ).toEqual(['desk-new']);
    expect(feeds.snapshot().machines.find((machine) => machine.instanceId === 'inst3')?.updatedAt).toBe(200);
    expect(feeds.listHeld('team1')).toEqual([fresh]);
    await feeds.stop();
  });

  test('logs a teammate’s kept lists it cannot read, and keeps the teammate’s own list', async () => {
    const logs = captureLogs();
    const ungated = spyOn(EgressGate, 'serializeView').mockImplementation((view) => JSON.stringify(view));
    const { feeds } = await setUp({ held: [null as unknown as TeamSnapshot] });
    await feeds.start();
    await until(
      'the garbled list is logged',
      () => logs.fieldsOf('[Teams] Could not check a teammate’s kept snapshots').length > 0
    );
    expect(feeds.snapshot().tasks).toHaveLength(2);
    logs.restore();
    ungated.mockRestore();
    await feeds.stop();
  });

  test('ignores a teammate’s copy for a machine with no signing key', async () => {
    const desk = await createSigner();
    const old = await Effect.runPromise(
      signTeamSnapshot(desk.privateKey, {
        teamId: 'team1',
        instanceId: 'inst3',
        tasks: [createHeldTask('desk-1')],
        updatedAt: 40,
      })
    );
    const keyless: TeamMachine = { id: 'inst3', name: 'Desk', userId: '9', online: false, lastSeenAt: 1 };
    const { feeds } = await setUp({ watcherMachines: [STUDIO, LAPTOP, keyless], held: [old] });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    expect(feeds.snapshot().tasks.every((task) => task.instanceId === 'inst1')).toBe(true);
    await feeds.stop();
  });
});

interface RelayPeer {
  messages: ShareMessage[];
  closed: string | null;
  send: (data: string | Uint8Array) => void;
  close: (code: number, reason: string) => void;
}

async function createStudioSigning() {
  const pair = (await crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = await Effect.runPromise(serializePublicKey(pair.publicKey));
  return { signing: { publicKey, privateKey: JSON.stringify(jwk) }, signingKey: publicKey };
}

function selectStudioKey(studio: Remote) {
  return studio.store.selectTeamKey('team1')?.key ?? null;
}

describe('handing the team key to a machine that has none', () => {
  test('one of your machines asks for it by itself, and gets it once you approve', async () => {
    const { signing, signingKey } = await createStudioSigning();
    const own = { ...STUDIO, userId: KAI.id, signingKey };
    const { feeds, studio } = await setUp({
      studioFile: {
        signing,
        owner: 'kai',
        access: { owner: KAI, members: [] },
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherMachines: [own, LAPTOP],
    });
    await feeds.start();
    await until('it asks', () => feeds.snapshot().machines[0]?.asking === true);
    expect(selectStudioKey(studio)).toBeNull();
    expect(await feeds.answerKeyRequest('team1', 'inst1', true)).toBe(true);
    await until('it is live with the handed key', () => feeds.snapshot().tasks.length === 2);
    expect(selectStudioKey(studio)).toBe(TEAM_KEY);
    await feeds.stop();
  });

  test('a teammate’s machine waits for the team’s owner to approve once it asks', async () => {
    const { signing, signingKey } = await createStudioSigning();
    const { feeds, studio, studioMachine, waits } = await setUp({
      studioFile: {
        signing,
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherFile: {
        teams: [createTeam({ owner: KAI, role: 'owner', machines: [{ ...STUDIO, signingKey }, LAPTOP] })],
      },
    });
    await feeds.start();
    await until('it is refused for the key', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(feeds.snapshot().machines[0]?.reason).toBe(TEAM_REFUSALS.key);
    expect(feeds.snapshot().machines[0]?.asking).toBeUndefined();
    await adaptTeams(studioMachine).requestKey('team1');
    waits.shift()?.();
    await until('it asks', () => feeds.snapshot().machines[0]?.asking === true);
    expect(selectStudioKey(studio)).toBeNull();
    expect(await feeds.answerKeyRequest('team1', 'inst1', true)).toBe(true);
    await until('it is live with the handed key', () => feeds.snapshot().tasks.length === 2);
    expect(selectStudioKey(studio)).toBe(TEAM_KEY);
    expect(await feeds.answerKeyRequest('team1', 'inst1', true)).toBe(false);
    await feeds.stop();
  });

  test('a declined request stops asking until the machine asks again', async () => {
    const { signing, signingKey } = await createStudioSigning();
    const { feeds, studio, studioMachine, waits } = await setUp({
      studioFile: {
        signing,
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherFile: {
        teams: [createTeam({ owner: KAI, role: 'owner', machines: [{ ...STUDIO, signingKey }, LAPTOP] })],
      },
    });
    await adaptTeams(studioMachine).requestKey('team1');
    await feeds.start();
    await until('it asks', () => feeds.snapshot().machines[0]?.asking === true);
    expect(await feeds.answerKeyRequest('team1', 'inst1', false)).toBe(true);
    expect(feeds.snapshot().machines[0]?.asking).toBeUndefined();
    waits.shift()?.();
    await until('it is refused again', () => waits.length === 1);
    expect(feeds.snapshot().machines[0]?.asking).toBeUndefined();
    expect(selectStudioKey(studio)).toBeNull();
    await feeds.stop();
  });

  test('a teammate’s machine that has not asked gets nothing, even when approved', async () => {
    const { signing, signingKey } = await createStudioSigning();
    const { feeds, studio, waits } = await setUp({
      studioFile: {
        signing,
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherFile: {
        teams: [createTeam({ owner: KAI, role: 'owner', machines: [{ ...STUDIO, signingKey }, LAPTOP] })],
      },
    });
    await feeds.start();
    await until('it is refused for the key', () => waits.length === 1);
    expect(await feeds.answerKeyRequest('team1', 'inst1', true)).toBe(false);
    expect(selectStudioKey(studio)).toBeNull();
    await feeds.stop();
  });

  test('logs a hand-over app.shinsa.dev does not connect, and keeps the machine refused', async () => {
    const { signing, signingKey } = await createStudioSigning();
    const own = { ...STUDIO, userId: KAI.id, signingKey };
    const { feeds, plane, studio, waits } = await setUp({
      studioFile: {
        signing,
        owner: 'kai',
        access: { owner: KAI, members: [] },
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherMachines: [own, LAPTOP],
    });
    let calls = 0;
    plane.answers.set(CONNECT_PATH, () => {
      calls += 1;
      return calls <= 2
        ? Response.json({ url: 'wss://t-inst1.shinsa.dev/team?token=t', expiresAt: 1 })
        : refuse(NotFound);
    });
    const logs = captureLogs();
    await feeds.start();
    await until('it asks', () => feeds.snapshot().machines[0]?.asking === true);
    expect(await feeds.answerKeyRequest('team1', 'inst1', true)).toBe(true);
    await until('the hand-over fails', () => calls === 3 && waits.length > 0);
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not hand a machine the team’s key')).toHaveLength(1);
    expect(selectStudioKey(studio)).toBeNull();
    await feeds.stop();
  });

  test('your own machine with no signing key gets nothing', async () => {
    const own = { ...STUDIO, userId: KAI.id };
    const { feeds, studio, waits } = await setUp({
      studioFile: {
        owner: 'kai',
        access: { owner: KAI, members: [] },
        teams: [createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 2 }] })],
        teamKeys: [],
      },
      watcherMachines: [own, LAPTOP],
    });
    await feeds.start();
    await until('it is refused for the key', () => waits.length === 1);
    expect(feeds.snapshot().machines[0]?.reason).toBe(TEAM_REFUSALS.key);
    expect(selectStudioKey(studio)).toBeNull();
    await feeds.stop();
  });
});

function createPeer(): RelayPeer {
  const peer: RelayPeer = {
    messages: [],
    closed: null,
    send: (data) => {
      const message = typeof data === 'string' ? Option.getOrNull(parseShareMessage(data)) : null;
      if (message) peer.messages.push(message);
    },
    close: (_code, reason) => {
      peer.closed = reason;
    },
  };
  return peer;
}

const FULL_VIEW_AT = 10_000_000_000_000;

function createFullLive(
  read: Effect.Effect<Uint8Array> = Effect.sync(() => new TextEncoder().encode('diff'))
) {
  return {
    view: {
      ...createShareView(
        { id: 'task', updatedAt: FULL_VIEW_AT },
        { files: { diff: { version: 'v1', type: 'text/plain' } }, updatedAt: 50 }
      ),
    },
    files: [{ id: 'diff', version: 'v1', type: 'text/plain', read }],
  };
}

async function readKeptViews(remote: Remote) {
  return openTeamViews(join(dirname(remote.store.path), TEAM_VIEWS_DIR));
}

async function listKeptViewKinds(remote: Remote, taskId: string) {
  return (await (await readKeptViews(remote)).select('team1', 'inst1', taskId))?.messages.map(
    (message) => message.t
  );
}

describe('keeping a teammate’s full tasks', () => {
  test('fetches each listed task’s full view a while after the list, with its files, and only the ones that changed', async () => {
    const { feeds, laptop, stub, sockets, viewWaits } = await setUp({ live: createFullLive() });
    const listKept = watchPublished(feeds, () => feeds.snapshot().tasks.length === 2);
    await feeds.start();
    await listKept('the list is kept');
    expect(viewWaits).toHaveLength(1);
    await releaseWait(viewWaits);
    await until('both views are kept', async () => (await (await readKeptViews(laptop)).list()).length === 2);
    expect(await listKeptViewKinds(laptop, 'task-1')).toEqual(['view', 'file', 'body', 'end']);
    expect(await listKeptViewKinds(laptop, 'task-2')).toEqual(['view', 'file', 'body', 'end']);
    const opened = sockets.length;
    stub.state.tasks['task-3'] = createTask({ id: 'task-3', repoId: 'repo-1', activity: [] });
    stub.notify();
    await until('the new task arrives', () => feeds.snapshot().tasks.length === 3);
    await releaseWait(viewWaits);
    await until(
      'the new view is kept',
      async () => (await (await readKeptViews(laptop)).list()).length === 3
    );
    expect(sockets.length - opened).toBe(1);
    await feeds.stop();
  });

  test('opens a kept task in full while its machine is offline, and lets the page reconnect once it is back', async () => {
    const { feeds, laptop, viewWaits } = await setUp({ live: createFullLive() });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await releaseWait(viewWaits);
    await until('the views are kept', async () => (await (await readKeptViews(laptop)).list()).length === 2);
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    await laptop.publish();
    const peer = createPeer();
    await feeds.openRelay(peer, TARGET_TASK);
    expect(peer.messages.map((message) => message.t)).toEqual(['view', 'file', 'body', 'end']);
    expect(peer.closed).toBeNull();
    const left = createPeer();
    (await feeds.openRelay(left, TARGET_TASK)).close();
    await laptop.store.recordTeams([createTeam({ role: 'member' })]);
    await laptop.publish();
    await until('the page is sent back to the live task', () => peer.closed !== null);
    expect(peer.closed).toBe(TEAM_FEED_OFFLINE);
    expect(left.closed).toBeNull();
    const live = createPeer();
    await feeds.openRelay(live, TARGET_TASK);
    await until('the live view arrives', () => live.messages.length > 0);
    await feeds.stop();
  });

  test('closes the pages it serves from kept views when it stops', async () => {
    const { feeds, laptop, viewWaits } = await setUp({ live: createFullLive() });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await releaseWait(viewWaits);
    await until('the views are kept', async () => (await (await readKeptViews(laptop)).list()).length === 2);
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    await laptop.publish();
    const peer = createPeer();
    await feeds.openRelay(peer, TARGET_TASK);
    expect(peer.messages.length).toBeGreaterThan(0);
    await feeds.stop();
    expect(peer.closed).toBe(TEAM_FEED_OFFLINE);
  });

  test('keeps the view of a task opened live, and nothing of a fetch that ran out of time before its view came', async () => {
    const { feeds, laptop, viewWaits } = await setUp({ live: createFullLive(Effect.never) });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    await feeds.openRelay(peer, TARGET_TASK);
    await until(
      'the live view is kept',
      async () => (await (await readKeptViews(laptop)).list()).length === 1
    );
    expect(await listKeptViewKinds(laptop, 'task-1')).toEqual(['view']);
    await releaseWait(viewWaits);
    await until('the fetch starts its clock', () => viewWaits.length === 1);
    await releaseWait(viewWaits);
    expect(await (await readKeptViews(laptop)).selectEntry('team1', 'inst1', 'task-2')).toBeNull();
    await feeds.stop();
  });

  test('drops a task’s view once it leaves the team or the list, and every view of a machine that leaves', async () => {
    const { feeds, laptop, stub, viewWaits } = await setUp({ live: createFullLive() });
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    await releaseWait(viewWaits);
    await until('the views are kept', async () => (await (await readKeptViews(laptop)).list()).length === 2);
    stub.state.tasks['task-3'] = createTask({ id: 'task-3', repoId: 'repo-1', activity: [] });
    stub.notify();
    await until('the new task arrives', () => feeds.snapshot().tasks.length === 3);
    if (stub.state.projects.p1) stub.state.projects.p1.teamIds = [];
    await releaseWait(viewWaits);
    await until('the refused fetch is done', () => viewWaits.length === 0);
    expect(await (await readKeptViews(laptop)).selectEntry('team1', 'inst1', 'task-3')).toBeNull();
    if (stub.state.projects.p1) stub.state.projects.p1.teamIds = ['team1'];
    delete stub.state.tasks['task-1'];
    const shorterListKept = watchPublished(feeds, () => feeds.snapshot().tasks.length === 2);
    stub.notify();
    await shorterListKept('the shorter list is kept');
    expect((await (await readKeptViews(laptop)).list()).map((entry) => entry.taskId)).toEqual(['task-2']);
    await laptop.store.recordTeams([createTeam({ role: 'member', machines: [LAPTOP] })]);
    await laptop.publish();
    expect(await (await readKeptViews(laptop)).list()).toEqual([]);
    await feeds.stop();
  });
});

const TARGET_TASK = { teamId: 'team1', instanceId: 'inst1', taskId: 'task-1' };

describe('relaying a teammate’s task to the local app', () => {
  const TARGET = { teamId: 'team1', instanceId: 'inst1', taskId: 'task-1' };

  test('streams the task in clear over localhost, and ends when it leaves the team', async () => {
    const { feeds, stub } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    await feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    const [sent] = peer.messages;
    expect(sent?.t).toBe('view');
    expect(JSON.parse(sent?.t === 'view' ? sent.data : 'null')).toEqual(
      readSentView(createShareView({ title: 'Live' }))
    );
    if (stub.state.projects.p1) stub.state.projects.p1.teamIds = [];
    stub.notify();
    await until('the relay ends', () => peer.closed !== null);
    expect(peer.messages.at(-1)).toEqual({ t: 'closed', reason: TEAM_REFUSALS.task });
    await feeds.stop();
  });

  test('says the machine is offline when its channel drops', async () => {
    const { feeds, sockets } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    await feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    sockets[1]?.drop();
    await until('the relay ends', () => peer.closed !== null);
    expect(peer.messages.at(-1)).toEqual({ t: 'closed', reason: TEAM_FEED_OFFLINE });
    await feeds.stop();
  });

  test('closes the page when remote access ends', async () => {
    const { feeds, laptop } = await setUp();
    await feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    const relay = await feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    laptop.access.end();
    expect(peer.closed).toBe(TEAM_FEED_OFFLINE);
    expect(peer.messages.at(-1)).toEqual({ t: 'closed', reason: TEAM_FEED_OFFLINE });
    relay.close();
    await feeds.stop();
  });

  test('refuses a machine it does not watch, and stops the channel when the page goes', async () => {
    const { feeds, sockets } = await setUp();
    await feeds.start();
    const unknown = createPeer();
    (await feeds.openRelay(unknown, { ...TARGET, instanceId: 'elsewhere' })).close();
    expect(unknown.closed).toBe(TEAM_VIEW_GONE);
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    const relay = await feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    relay.close();
    relay.close();
    expect(peer.closed).toBeNull();
    const kept = createPeer();
    await feeds.openRelay(kept, TARGET);
    await until('the second view arrives', () => kept.messages.length === 1);
    await feeds.stop();
    expect(sockets).toHaveLength(3);
  });
});

type Script = (hello: string, emit: (type: string, data?: unknown) => void) => Promise<void>;

function createScriptedSocket(script: Script) {
  return (url: string, origin: string): FeedSocket & { url: string; origin: string } => {
    const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {
      open: [],
      message: [],
      close: [],
    };
    const emit = (type: string, data?: unknown) => {
      for (const listener of listeners[type] ?? []) listener({ data });
    };
    queueMicrotask(() => emit('open'));
    return {
      url,
      origin,
      binaryType: '',
      send: (data) => void script(data, emit),
      close: () => undefined,
      addEventListener: (type, listener) => listeners[type]?.push(listener),
    };
  };
}

async function signWelcome(hello: string, key: string) {
  const parsed = Option.getOrNull(parseTeamHello(hello));
  if (!parsed) throw new Error('not a team hello');
  const server = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const welcome = await Effect.runPromise(
    createTeamWelcome(key, {
      team: parsed.team,
      view: parsed.view,
      clientEphemeral: parsed.ephemeral,
      serverEphemeral: await Effect.runPromise(serializePublicKey(server.publicKey)),
    })
  );
  return JSON.stringify(welcome);
}

describe('a teammate’s machine that cannot be trusted or read', () => {
  const TARGET = { teamId: 'team1', instanceId: 'inst1', key: TEAM_KEY, view: { kind: 'list' as const } };

  async function openScripted(script: Script) {
    const { plane, restart } = await setUp();
    const feeds = await restart({ createSocket: createScriptedSocket(script) });
    const ends: { reason: string; gone: boolean }[] = [];
    const messages: ShareMessage[] = [];
    feeds.openStream(TARGET, {
      onMessage: (message) => messages.push(message),
      onEnd: (end) => ends.push(end),
    });
    return { plane, ends, messages };
  }

  test('refuses a welcome not signed with the team key', async () => {
    const { ends } = await openScripted(async (hello, emit) =>
      emit('message', await signWelcome(hello, OTHER_KEY))
    );
    await until('it ends', () => ends.length === 1);
    expect(ends).toEqual([{ reason: TEAM_FEED_REFUSED, gone: true }]);
  });

  test('drops a channel that sends something it cannot read', async () => {
    const garbled = await openScripted(async (hello, emit) => {
      emit('message', await signWelcome(hello, TEAM_KEY));
      emit('message', new Uint8Array(40).fill(1).buffer);
    });
    await until('it ends', () => garbled.ends.length === 1);
    expect(garbled.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
    const early = await openScripted(async (_hello, emit) => emit('message', new Uint8Array(4).buffer));
    await until('it ends', () => early.ends.length === 1);
    expect(early.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
    const twice = await openScripted(async (_hello, emit) => emit('message', '{"type":"nonsense"}'));
    await until('it ends', () => twice.ends.length === 1);
    expect(twice.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
  });

  test('hands each message of a stream to its handler', async () => {
    const { feeds } = await setUp();
    const messages: ShareMessage[] = [];
    const stop = feeds.openStream(TARGET, {
      onMessage: (message) => messages.push(message),
      onEnd: () => undefined,
    });
    await until('the list arrives', () => messages.length === 1);
    expect(messages[0]?.t).toBe('view');
    stop();
  });

  test('ends offline when the socket cannot be made', async () => {
    const { restart } = await setUp();
    const logs = captureLogs();
    const feeds = await restart({
      createSocket: () => {
        throw new Error('no socket');
      },
    });
    const ends: { reason: string; gone: boolean }[] = [];
    feeds.openStream(TARGET, { onMessage: () => undefined, onEnd: (end) => ends.push(end) });
    await until('it ends', () => ends.length === 1);
    logs.restore();
    expect(ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
    expect(logs.fieldsOf('[Teams] Could not reach a teammate’s machine')).toEqual([
      { teamId: 'team1', instanceId: 'inst1', error: 'no socket' },
    ]);
  });

  test('stops a stream before it ends without telling its handlers', async () => {
    const { plane, restart } = await setUp();
    const feeds = await restart();
    const ends: { reason: string; gone: boolean }[] = [];
    const stop = feeds.openStream(TARGET, { onMessage: () => undefined, onEnd: (end) => ends.push(end) });
    stop();
    await until(
      'the connect call was not made',
      () => !plane.calls.some((call) => call.path === CONNECT_PATH)
    );
    expect(ends).toEqual([]);
  });

  test('is refused once this machine is no longer paired', async () => {
    const { laptop, restart } = await setUp();
    await laptop.store.update((file) => ({ ...file, credentials: null }));
    const feeds = await restart();
    const ends: { reason: string; gone: boolean }[] = [];
    feeds.openStream(TARGET, { onMessage: () => undefined, onEnd: (end) => ends.push(end) });
    await until('it ends', () => ends.length === 1);
    expect(ends).toEqual([{ reason: TEAM_FEED_REFUSED, gone: true }]);
  });

  test('opens a real socket to the machine with app.shinsa.dev as its origin, and waits on a real timer', async () => {
    const origins: (string | null)[] = [];
    const tunnel = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request, server) {
        origins.push(request.headers.get('origin'));
        if (server.upgrade(request)) return undefined;
        return new Response('no', { status: 400 });
      },
      websocket: { message: (socket) => socket.close(), open: () => undefined },
    });
    try {
      const { plane, restart } = await setUp();
      plane.answers.set(CONNECT_PATH, () =>
        Response.json({ url: `ws://127.0.0.1:${tunnel.port}/team?token=t`, expiresAt: 1 })
      );
      const feeds = await restart();
      await feeds.start();
      await until(
        'the machine is offline after the drop',
        () => feeds.snapshot().machines[0]?.reason === TEAM_FEED_OFFLINE && origins.length === 1
      );
      expect(origins).toEqual([plane.origin]);
      await feeds.stop();
    } finally {
      await tunnel.stop(true);
    }
  });
});
