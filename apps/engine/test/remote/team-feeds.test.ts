import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createTeamWelcome,
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
} from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import { createTeamFeedRoutes } from '../../src/remote/routes.ts';
import {
  type FeedSocket,
  TEAM_FEED_OFFLINE,
  TEAM_FEED_REFUSED,
  TEAM_VIEW_GONE,
  TeamFeeds,
} from '../../src/remote/team-feeds.ts';
import { TEAM_SNAPSHOTS_FILE } from '../../src/remote/team-snapshots.ts';
import { TEAM_GONE_REASON, Teams } from '../../src/remote/teams.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

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

function writeRemoteFile(file: Record<string, unknown>) {
  const path = join(createTempDir(), 'remote.json');
  writeFileSync(path, JSON.stringify({ enabled: true, ...file }));
  return path;
}

function createRemote(path: string, plane: FakeControlPlane) {
  return new Remote({
    path,
    control: new ControlClient({ origin: plane.origin }),
    connect: () => Promise.reject(new Error('no tunnel in this test')),
    localUrl: () => 'http://127.0.0.1:1',
    version: '1',
    maxBodyBytes: 1024,
    machineName: 'Studio',
    openUrl: () => Promise.resolve(),
  });
}

function credentials(instanceId: string) {
  return {
    instanceId,
    machineToken: `${instanceId}-token`,
    tunnelToken: 'tunnel',
    tunnelHost: `t-${instanceId}.shinsa.dev`,
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
  watcherKey?: string;
  watcherFile?: Record<string, unknown>;
  watcherMachines?: TeamMachine[];
  held?: TeamSnapshot[];
  now?: () => number;
}

function setUp(options: SetUp = {}) {
  const plane = startFakeControlPlane();
  running = plane;
  plane.answers.set(CONNECT_PATH, () =>
    Response.json({ url: 'wss://t-inst1.shinsa.dev/team?token=t', expiresAt: 1 })
  );
  const studio = createRemote(
    writeRemoteFile({
      credentials: credentials('inst1'),
      owner: 'mona',
      access: { owner: MONA, members: [] },
      teams: [createTeam()],
      teamKeys: [createKey()],
    }),
    plane
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
  const live = { view: { live: true }, files: [] };
  const teams = new Teams({
    engine: stub.engine,
    remote: studio,
    shares: { resolveLive: () => Promise.resolve(live as never) },
    transcripts: { subscribe: () => () => undefined },
    held: { listHeld: () => options.held ?? [], subscribeHeld: () => () => true },
    now: () => 50,
  });
  const laptop = createRemote(
    writeRemoteFile({
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
    }),
    plane
  );
  const sockets: FakeFeedSocket[] = [];
  const waits: (() => void)[] = [];
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
      KAI.id
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
  const feeds = new TeamFeeds({
    remote: laptop,
    createSocket,
    now: options.now ?? (() => 60),
    wait: (_ms, run) => {
      waits.push(run);
      return () => waits.splice(waits.indexOf(run), 1);
    },
  });
  return { plane, stub, studio, laptop, teams, feeds, sockets, waits };
}

function listMachineStatus(feeds: TeamFeeds) {
  return feeds.snapshot().machines.map((machine) => [machine.instanceId, machine.status, machine.reason]);
}

describe('watching teammates’ machines', () => {
  test('lists a teammate’s team tasks with the team and machine, leaving this machine out', async () => {
    const { feeds, sockets, plane } = setUp();
    const changes: number[] = [];
    const unsubscribe = feeds.subscribe(() => changes.push(1));
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    expect(sockets.map((socket) => [socket.url, socket.origin])).toEqual([
      ['wss://t-inst1.shinsa.dev/team?token=t', plane.origin],
    ]);
    expect(plane.calls.find((call) => call.path === CONNECT_PATH)).toMatchObject({
      token: 'inst2-token',
      body: { instanceId: 'inst1' },
    });
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'live', null]]);
    expect(feeds.snapshot().tasks[0]).toMatchObject({
      teamId: 'team1',
      instanceId: 'inst1',
      owner: 'mona',
      task: { id: 'task-1' },
    });
    expect(feeds.listTasks({ open: true }).map((task) => task.task.id)).toEqual(['task-1']);
    expect(feeds.listTasks({ teamId: 'other' })).toEqual([]);
    expect(changes.length).toBeGreaterThan(1);
    unsubscribe();
    const heard = changes.length;
    feeds.sync();
    expect(changes).toHaveLength(heard);
    feeds.stop();
  });

  test('serves the tasks to the engine’s read API, open ones on request', async () => {
    const { feeds } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const [route] = createTeamFeedRoutes(feeds);
    const request = (query: string) =>
      route?.respond(
        [] as unknown as RegExpExecArray,
        new Request(`http://localhost/api/teams/tasks${query}`)
      );
    const all = (await (await request(''))?.json()) as {
      tasks: { task: { id: string } }[];
      machines: unknown[];
    };
    expect(all.tasks.map((task) => task.task.id)).toEqual(['task-1', 'task-2']);
    expect(all.machines).toHaveLength(1);
    const open = (await (await request('?team=team1&open=true'))?.json()) as { tasks: unknown[] };
    expect(open.tasks).toHaveLength(1);
    expect(route?.pattern.test('/api/teams/tasks')).toBe(true);
    feeds.stop();
  });

  test('follows the teammate’s machine as it changes, and keeps its last list while it is offline', async () => {
    const { feeds, stub, laptop, sockets } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    stub.state.tasks['task-3'] = createTask({ id: 'task-3', repoId: 'repo-1', activity: [] });
    stub.notify();
    await until('the new task arrives', () => feeds.snapshot().tasks.length === 3);
    laptop.store.recordTeams([
      createTeam({ role: 'member', machines: [{ ...STUDIO, online: false }, LAPTOP] }),
    ]);
    laptop.publish();
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    expect(feeds.snapshot().machines[0]?.updatedAt).toBe(50);
    expect(
      feeds
        .snapshot()
        .tasks.map((task) => task.task.id)
        .sort()
    ).toEqual(['task-1', 'task-2', 'task-3']);
    laptop.store.recordTeams([createTeam({ role: 'member' })]);
    laptop.publish();
    await until('it connects again', () => feeds.snapshot().machines[0]?.status === 'live');
    expect(sockets).toHaveLength(2);
    feeds.stop();
  });

  test('tries again after a dropped channel, and starts over once live', async () => {
    const { feeds, sockets, waits } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    sockets[0]?.drop();
    await until('the drop is seen', () => waits.length === 1);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    expect(feeds.snapshot().tasks).toHaveLength(2);
    waits.shift()?.();
    await until('it is live again', () => feeds.snapshot().machines[0]?.status === 'live');
    expect(sockets).toHaveLength(2);
    feeds.stop();
  });

  test('tries a refusing machine again only after a long wait, and at once with a new key', async () => {
    const { feeds, laptop, sockets, waits } = setUp({ watcherKey: OTHER_KEY });
    feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'refused', TEAM_GONE_REASON]]);
    expect(waits).toHaveLength(1);
    laptop.publish();
    expect(sockets).toHaveLength(1);
    waits.shift()?.();
    await until('it is refused again', () => sockets.length === 2 && waits.length === 1);
    laptop.store.upsertTeamKey(createKey());
    laptop.publish();
    await until('it is live with the new key', () => feeds.snapshot().tasks.length === 2);
    feeds.stop();
  });

  test('is refused when app.shinsa.dev says the machine is not in the team', async () => {
    const { feeds, plane } = setUp();
    plane.answers.set(CONNECT_PATH, () => Response.json({ error: { code: 'not_found' } }, { status: 404 }));
    feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'refused', TEAM_FEED_REFUSED]]);
    feeds.stop();
  });

  test('a new member refused before the teammate’s machine heard of them gets in on the next try', async () => {
    const { feeds, plane, waits } = setUp();
    plane.answers.set(CONNECT_PATH, () => Response.json({ error: { code: 'not_found' } }, { status: 404 }));
    feeds.start();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    plane.answers.set(CONNECT_PATH, () =>
      Response.json({ url: 'wss://t-inst1.shinsa.dev/team?token=t', expiresAt: 1 })
    );
    waits.shift()?.();
    await until('it is live', () => feeds.snapshot().tasks.length === 2);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'live', null]]);
    feeds.stop();
  });

  test('waits and tries again when app.shinsa.dev cannot be reached', async () => {
    const { feeds, plane, waits } = setUp();
    plane.answers.set(CONNECT_PATH, () => new Response('down', { status: 502 }));
    feeds.start();
    await until('it waits', () => waits.length === 1);
    expect(listMachineStatus(feeds)).toEqual([['inst1', 'offline', TEAM_FEED_OFFLINE]]);
    feeds.stop();
    expect(waits).toEqual([]);
  });

  test('watches nothing without remote access, a key or a pairing', async () => {
    const off = setUp({ watcherFile: { enabled: false } });
    off.feeds.start();
    expect(off.feeds.snapshot()).toEqual({ machines: [], tasks: [] });
    const keyless = setUp({ watcherFile: { teamKeys: [] } });
    keyless.feeds.start();
    expect(keyless.feeds.snapshot().machines).toEqual([]);
    const { feeds, laptop } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    laptop.store.removeTeam('team1');
    laptop.publish();
    expect(feeds.snapshot()).toEqual({ machines: [], tasks: [] });
  });
});

function readKeptFile(feedsPath: string) {
  if (!existsSync(feedsPath)) return null;
  return JSON.parse(readFileSync(feedsPath, 'utf8')) as {
    lists: { teamId: string; instanceId: string; updatedAt: number; snapshot: TeamSnapshot | null }[];
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
  return { privateKey: pair.privateKey, signingKey: await serializePublicKey(pair.publicKey) };
}

function createHeldTask(id: string): TeamTask {
  return { owner: 'lee', machine: 'Desk', task: { id } } as unknown as TeamTask;
}

describe('keeping a teammate’s last list', () => {
  test('keeps it on disk, signed, and shows it after a restart while the machine is offline', async () => {
    const { feeds, laptop } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const kept = readKeptFile(resolveKeptPath(laptop));
    expect(kept?.lists.map((list) => [list.teamId, list.instanceId, list.updatedAt])).toEqual([
      ['team1', 'inst1', 50],
    ]);
    expect(kept?.lists[0]?.snapshot?.signature).toEqual(expect.any(String));
    feeds.stop();
    laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    const restarted = new TeamFeeds({ remote: laptop, now: () => 60 });
    restarted.start();
    expect(restarted.snapshot().machines).toEqual([
      expect.objectContaining({ instanceId: 'inst1', status: 'offline', updatedAt: 50 }),
    ]);
    expect(restarted.snapshot().tasks).toHaveLength(2);
    expect(restarted.listHeld('team1')).toHaveLength(1);
    expect(restarted.listHeld('other')).toEqual([]);
    restarted.stop();
  });

  test('drops it after 30 days, and when the team key changes', async () => {
    const { feeds, laptop } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    feeds.stop();
    laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    const late = new TeamFeeds({ remote: laptop, now: () => 51 + TEAM_SNAPSHOT_TTL_MS });
    late.start();
    expect(late.snapshot().tasks).toEqual([]);
    expect(late.snapshot().machines[0]?.updatedAt).toBeUndefined();
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    late.stop();
    let now = 60;
    const aging = setUp({ now: () => now });
    aging.feeds.start();
    await until('the list arrives', () => aging.feeds.snapshot().tasks.length === 2);
    aging.laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    aging.laptop.publish();
    expect(aging.feeds.snapshot().tasks).toHaveLength(2);
    now = 51 + TEAM_SNAPSHOT_TTL_MS;
    expect(aging.feeds.snapshot().tasks).toEqual([]);
    expect(aging.feeds.listHeld('team1')).toEqual([]);
    aging.feeds.stop();
    const again = setUp();
    again.feeds.start();
    await until('the list arrives', () => again.feeds.snapshot().tasks.length === 2);
    again.laptop.store.recordTeams([createTeam({ role: 'member', machines: [OFFLINE_STUDIO, LAPTOP] })]);
    again.laptop.publish();
    expect(again.feeds.snapshot().tasks).toHaveLength(2);
    again.laptop.store.upsertTeamKey(createKey(OTHER_KEY));
    again.laptop.publish();
    expect(again.feeds.snapshot().tasks).toEqual([]);
    expect(readKeptFile(resolveKeptPath(again.laptop))).toBeNull();
  });

  test('drops it when the machine leaves the team or this machine leaves it, and keeps it while remote access is paused', async () => {
    const { feeds, laptop } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    laptop.store.update((file) => ({ ...file, enabled: false }));
    laptop.publish();
    expect(readKeptFile(resolveKeptPath(laptop))?.lists).toHaveLength(1);
    laptop.store.update((file) => ({ ...file, enabled: true }));
    laptop.store.recordTeams([createTeam({ role: 'member', machines: [LAPTOP] })]);
    laptop.publish();
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    const other = setUp();
    other.feeds.start();
    await until('the list arrives', () => other.feeds.snapshot().tasks.length === 2);
    other.laptop.store.removeTeam('team1');
    other.laptop.publish();
    expect(readKeptFile(resolveKeptPath(other.laptop))).toBeNull();
    other.feeds.stop();
  });

  test('drops it when the teammate’s machine refuses this one', async () => {
    const { feeds, laptop, plane, sockets, waits } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    plane.answers.set(CONNECT_PATH, () => Response.json({ error: { code: 'not_found' } }, { status: 404 }));
    sockets[0]?.drop();
    await until('the drop is seen', () => waits.length === 1);
    waits.shift()?.();
    await until('it is refused', () => feeds.snapshot().machines[0]?.status === 'refused');
    expect(feeds.snapshot().tasks).toEqual([]);
    expect(feeds.listHeld('team1')).toEqual([]);
    expect(readKeptFile(resolveKeptPath(laptop))).toBeNull();
    feeds.stop();
  });

  test('takes an offline machine’s list from a teammate only when that machine’s own key signed it', async () => {
    const desk = await createSigner();
    const forger = await createSigner();
    const body = { teamId: 'team1', instanceId: 'inst3', tasks: [createHeldTask('desk-1')], updatedAt: 40 };
    const signed = await signTeamSnapshot(desk.privateKey, body);
    const forged = await signTeamSnapshot(forger.privateKey, {
      ...body,
      tasks: [createHeldTask('fake')],
      updatedAt: 45,
    });
    const elsewhere = await signTeamSnapshot(desk.privateKey, { ...body, teamId: 'team2', updatedAt: 46 });
    const unknown = await signTeamSnapshot(desk.privateKey, { ...body, instanceId: 'inst9' });
    const desktop: TeamMachine = {
      id: 'inst3',
      name: 'Desk',
      userId: '9',
      online: false,
      lastSeenAt: 1,
      signingKey: desk.signingKey,
    };
    const { feeds, laptop } = setUp({
      watcherMachines: [STUDIO, LAPTOP, desktop],
      held: [forged, elsewhere, unknown, signed],
    });
    const heard: number[] = [];
    const stopHearing = feeds.subscribeHeld(() => heard.push(1));
    feeds.start();
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
    expect(feeds.listHeld('team1')).toEqual([signed]);
    expect(heard.length).toBeGreaterThan(0);
    expect(stopHearing()).toBe(true);
    expect(
      readKeptFile(resolveKeptPath(laptop))
        ?.lists.map((list) => list.instanceId)
        .sort()
    ).toEqual(['inst1', 'inst3']);
    feeds.stop();
  });

  test('logs a teammate’s kept lists it cannot read, and keeps the teammate’s own list', async () => {
    const warn = spyOn(log, 'warn');
    const { feeds } = setUp({ held: [null as unknown as TeamSnapshot] });
    feeds.start();
    await until('the garbled list is logged', () =>
      warn.mock.calls.some(([message]) => message === '[Teams] Could not check a teammate’s kept snapshots')
    );
    expect(feeds.snapshot().tasks).toHaveLength(2);
    warn.mockRestore();
    feeds.stop();
  });

  test('ignores a teammate’s copy for a machine with no signing key', async () => {
    const desk = await createSigner();
    const old = await signTeamSnapshot(desk.privateKey, {
      teamId: 'team1',
      instanceId: 'inst3',
      tasks: [createHeldTask('desk-1')],
      updatedAt: 40,
    });
    const keyless: TeamMachine = { id: 'inst3', name: 'Desk', userId: '9', online: false, lastSeenAt: 1 };
    const { feeds } = setUp({ watcherMachines: [STUDIO, LAPTOP, keyless], held: [old] });
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    expect(feeds.snapshot().tasks.every((task) => task.instanceId === 'inst1')).toBe(true);
    feeds.stop();
  });
});

interface RelayPeer {
  messages: ShareMessage[];
  closed: string | null;
  send: (data: string | Uint8Array) => void;
  close: (code: number, reason: string) => void;
}

function createPeer(): RelayPeer {
  const peer: RelayPeer = {
    messages: [],
    closed: null,
    send: (data) => {
      const message = typeof data === 'string' ? parseShareMessage(data) : null;
      if (message) peer.messages.push(message);
    },
    close: (_code, reason) => {
      peer.closed = reason;
    },
  };
  return peer;
}

describe('relaying a teammate’s task to the local app', () => {
  const TARGET = { teamId: 'team1', instanceId: 'inst1', taskId: 'task-1' };

  test('streams the task in clear over localhost, and ends when it leaves the team', async () => {
    const { feeds, stub } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    expect(peer.messages[0]).toEqual({ t: 'view', data: JSON.stringify({ live: true }) });
    if (stub.state.projects.p1) stub.state.projects.p1.teamIds = [];
    stub.notify();
    await until('the relay ends', () => peer.closed !== null);
    expect(peer.messages.at(-1)).toEqual({ t: 'closed', reason: TEAM_GONE_REASON });
    feeds.stop();
  });

  test('says the machine is offline when its channel drops', async () => {
    const { feeds, sockets } = setUp();
    feeds.start();
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    sockets[1]?.drop();
    await until('the relay ends', () => peer.closed !== null);
    expect(peer.messages.at(-1)).toEqual({ t: 'closed', reason: TEAM_FEED_OFFLINE });
    feeds.stop();
  });

  test('refuses a machine it does not watch, and stops the channel when the page goes', async () => {
    const { feeds, sockets } = setUp();
    feeds.start();
    const unknown = createPeer();
    feeds.openRelay(unknown, { ...TARGET, instanceId: 'elsewhere' }).close();
    expect(unknown.closed).toBe(TEAM_VIEW_GONE);
    await until('the list arrives', () => feeds.snapshot().tasks.length === 2);
    const peer = createPeer();
    const relay = feeds.openRelay(peer, TARGET);
    await until('the view arrives', () => peer.messages.length === 1);
    relay.close();
    relay.close();
    expect(peer.closed).toBeNull();
    const kept = createPeer();
    feeds.openRelay(kept, TARGET);
    await until('the second view arrives', () => kept.messages.length === 1);
    feeds.stop();
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
  const parsed = parseTeamHello(hello);
  if (!parsed) throw new Error('not a team hello');
  const server = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const welcome = await createTeamWelcome(key, {
    team: parsed.team,
    view: parsed.view,
    clientEphemeral: parsed.ephemeral,
    serverEphemeral: await serializePublicKey(server.publicKey),
  });
  return JSON.stringify(welcome);
}

describe('a teammate’s machine that cannot be trusted or read', () => {
  const TARGET = { teamId: 'team1', instanceId: 'inst1', key: TEAM_KEY, view: { kind: 'list' as const } };

  function openScripted(script: Script) {
    const { plane, laptop } = setUp();
    const feeds = new TeamFeeds({ remote: laptop, createSocket: createScriptedSocket(script) });
    const ends: { reason: string; gone: boolean }[] = [];
    const messages: ShareMessage[] = [];
    feeds.openStream(TARGET, {
      onMessage: (message) => messages.push(message),
      onEnd: (end) => ends.push(end),
    });
    return { plane, ends, messages };
  }

  test('refuses a welcome not signed with the team key', async () => {
    const { ends } = openScripted(async (hello, emit) =>
      emit('message', await signWelcome(hello, OTHER_KEY))
    );
    await until('it ends', () => ends.length === 1);
    expect(ends).toEqual([{ reason: TEAM_FEED_REFUSED, gone: true }]);
  });

  test('drops a channel that sends something it cannot read', async () => {
    const garbled = openScripted(async (hello, emit) => {
      emit('message', await signWelcome(hello, TEAM_KEY));
      emit('message', new Uint8Array(40).fill(1).buffer);
    });
    await until('it ends', () => garbled.ends.length === 1);
    expect(garbled.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
    const early = openScripted(async (_hello, emit) => emit('message', new Uint8Array(4).buffer));
    await until('it ends', () => early.ends.length === 1);
    expect(early.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
    const twice = openScripted(async (_hello, emit) => emit('message', '{"type":"nonsense"}'));
    await until('it ends', () => twice.ends.length === 1);
    expect(twice.ends).toEqual([{ reason: TEAM_FEED_OFFLINE, gone: false }]);
  });

  test('is refused once this machine is no longer paired', async () => {
    const { laptop } = setUp();
    laptop.store.update((file) => ({ ...file, credentials: null }));
    const feeds = new TeamFeeds({ remote: laptop });
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
      const { plane, laptop } = setUp();
      plane.answers.set(CONNECT_PATH, () =>
        Response.json({ url: `ws://127.0.0.1:${tunnel.port}/team?token=t`, expiresAt: 1 })
      );
      const feeds = new TeamFeeds({ remote: laptop });
      feeds.start();
      await until(
        'the machine is offline after the drop',
        () => feeds.snapshot().machines[0]?.reason === TEAM_FEED_OFFLINE && origins.length === 1
      );
      expect(origins).toEqual([plane.origin]);
      feeds.stop();
    } finally {
      await tunnel.stop(true);
    }
  });
});
