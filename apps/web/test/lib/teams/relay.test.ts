import { describe, expect, it, mock } from 'bun:test';
import { DEFAULT_TEAM_SCOPES, resolveEngineInfo, type RemoteSnapshot } from '@shinsa/core';
import { RouteNotFound, type TeamRelayEntry } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { Socket } from 'effect/socket';
import { type Connection, connection } from '@/lib/connection/socket.ts';
import type { Fleet } from '@/lib/remote/fleet.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import {
  createLocalMember,
  createRelayMember,
  LocalRelays,
  type RelayTarget,
  resolveRelayRequest,
  resolveRelayTargets,
  startLocalRelays,
} from '@/lib/teams/relay.ts';
import { FakeConnection } from '../../support/connection.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createTeam, createTeamEntry, KAI, MONA } from '../../support/teams.ts';

const ORIGIN = { protocol: 'http:', host: 'localhost:7446' };

const STUDIO = { id: 'studio', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: null };

const STUDIO_RELAY: TeamRelayEntry = {
  instanceId: 'studio',
  teamId: 'team1',
  name: 'Studio',
  userId: MONA.id,
};

function createKaiRemote(overrides: Partial<RemoteSnapshot> = {}) {
  return createRemoteSnapshot({
    instanceId: 'laptop',
    owner: KAI.id,
    machineName: 'Laptop',
    teams: [createTeamEntry({ team: createTeam({ role: 'member', machines: [STUDIO] }) })],
    ...overrides,
  });
}

function createLocal(remote: RemoteSnapshot | null = createKaiRemote()) {
  const local = new FakeConnection();
  local.remote = remote;
  local.engine = resolveEngineInfo('1.0.0');
  return local;
}

function createRelayConnection() {
  const relayed = new FakeConnection();
  return Object.assign(relayed, { stop: mock(() => undefined) });
}

function createTarget(): RelayTarget {
  return { entry: STUDIO_RELAY, teammate: { owner: MONA, viewerId: KAI.id, scopes: [] }, online: true };
}

function openWith(transport: SocketTransport) {
  const open = Effect.runSync(Effect.provide(Socket.WebSocketConstructor.use(Effect.succeed), transport));
  return open('ws://ignored');
}

function flushRequests() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the local fleet relay', () => {
  it('sends a request to a teammate machine under its relay path, with its method, query and body', async () => {
    const request = resolveRelayRequest(
      new Request('http://localhost:7446/api/tasks/t1/diff?full=1', { method: 'POST', body: 'hello' }),
      'studio'
    );
    expect(new URL(request.url).pathname).toBe('/api/teams/relay/studio/api/tasks/t1/diff');
    expect(new URL(request.url).search).toBe('?full=1');
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('hello');
  });

  it('names each relayed machine’s owner and the scopes the team gives this account', () => {
    const extra: TeamRelayEntry = { instanceId: 'gone', teamId: 'team1', name: 'Gone', userId: 'nobody' };
    const missing: TeamRelayEntry = { instanceId: 'other', teamId: 'team9', name: 'Other', userId: KAI.id };
    const [target, ...rest] = resolveRelayTargets([STUDIO_RELAY, extra, missing], createKaiRemote());
    expect(rest).toEqual([]);
    expect(target).toEqual({
      entry: STUDIO_RELAY,
      teammate: { owner: MONA, viewerId: KAI.id, scopes: [...DEFAULT_TEAM_SCOPES] },
      online: true,
    });
    const asOwner = createRemoteSnapshot({ teams: [createTeamEntry({ team: createTeam() })] });
    const kaiMachine: TeamRelayEntry = {
      instanceId: 'kai-mac',
      teamId: 'team1',
      name: 'Kai',
      userId: KAI.id,
    };
    expect(resolveRelayTargets([kaiMachine], { ...asOwner, owner: MONA.id })).toEqual([
      { entry: kaiMachine, teammate: { owner: KAI, viewerId: MONA.id, scopes: [] }, online: false },
    ]);
    expect(resolveRelayTargets([STUDIO_RELAY], createKaiRemote({ owner: null }))).toEqual([]);
    expect(
      resolveRelayTargets([STUDIO_RELAY], createKaiRemote({ teams: [createTeamEntry({ team: null })] }))
    ).toEqual([]);
  });

  it('opens a teammate machine’s socket and requests through the local relay, never the machine itself', async () => {
    const opened: string[] = [];
    const sent: string[] = [];
    const relayed = createRelayConnection();
    let transport: SocketTransport | null = null;
    const member = createRelayMember(createTarget(), {
      origin: ORIGIN,
      openSocket: (url) => {
        opened.push(url);
        return {} as WebSocket;
      },
      send: (request) => {
        sent.push(new URL(request.url).pathname);
        return Promise.resolve(new Response('ok'));
      },
      createConnection: (given) => {
        transport = given;
        return relayed as unknown as Connection;
      },
    });
    expect(member).toMatchObject({
      id: 'studio',
      name: 'Studio',
      online: true,
      teammate: createTarget().teammate,
    });
    openWith(transport as unknown as SocketTransport);
    expect(opened).toEqual(['ws://localhost:7446/ws/teams/relay/studio']);
    expect(await (await member.fetch(new Request('http://localhost:7446/api/tasks'))).text()).toBe('ok');
    expect(sent).toEqual(['/api/teams/relay/studio/api/tasks']);
    expect(member.resolveUrl?.('/api/evidence/t/round-1/a.png')).toBe(
      '/api/teams/relay/studio/api/evidence/t/round-1/a.png'
    );
    member.close?.();
    expect(relayed.stop).toHaveBeenCalledTimes(1);
    const realWebSocket = globalThis.WebSocket;
    const dialed: string[] = [];
    globalThis.WebSocket = class {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
        dialed.push(url);
      }
    } as unknown as typeof WebSocket;
    let secure: SocketTransport | null = null;
    createRelayMember(createTarget(), {
      origin: { protocol: 'https:', host: 'mac.local' },
      createConnection: (given) => {
        secure = given;
        return relayed as unknown as Connection;
      },
    });
    openWith(secure as unknown as SocketTransport);
    globalThis.WebSocket = realWebSocket;
    expect(dialed).toEqual(['wss://mac.local/ws/teams/relay/studio']);
  });

  it('keeps this machine first, with its own terminals and requests', async () => {
    const local = createLocal();
    const opened: string[] = [];
    const member = createLocalMember(
      local,
      { instanceId: 'laptop', machineName: 'Laptop' },
      {
        origin: ORIGIN,
        openSocket: (url) => {
          opened.push(url);
          return {} as WebSocket;
        },
        send: () => Promise.resolve(new Response('local')),
      }
    );
    expect(member).toMatchObject({ id: 'laptop', name: 'Laptop', current: true, online: true });
    expect(member.connection).toBe(local);
    member.openTerminal?.('t 1');
    expect(opened).toEqual(['ws://localhost:7446/ws/terminals/t%201']);
    expect(await (await member.fetch(new Request('http://localhost:7446/api/x'))).text()).toBe('local');
  });

  it('becomes a fleet once a teammate machine is relayed, and follows the team as it changes', async () => {
    const local = createLocal();
    const answers: (readonly TeamRelayEntry[])[] = [[], [STUDIO_RELAY], [], [STUDIO_RELAY]];
    let asked = 0;
    const fleets: Fleet[] = [];
    const relays = new LocalRelays({
      local,
      origin: ORIGIN,
      createConnection: () => createRelayConnection() as unknown as Connection,
      requestRelays: Effect.sync(() => answers[asked++] ?? []),
      onFleet: (fleet) => fleets.push(fleet),
    });
    const stop = relays.start();
    await flushRequests();
    expect(asked).toBe(1);
    expect(relays.fleet).toBeNull();

    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(1);

    local.remote = createKaiRemote({ machineName: 'Laptop 2', status: 'reconnecting' });
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(1);

    local.remote = createKaiRemote({ instanceId: 'laptop-3' });
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(2);
    expect(fleets).toHaveLength(1);
    expect(relays.fleet?.members.map((member) => member.id)).toEqual(['laptop-3', 'studio']);

    local.remote = createKaiRemote({ instanceId: 'laptop-4' });
    local.signal.publish();
    await flushRequests();
    expect(relays.fleet?.members.map((member) => member.id)).toEqual(['laptop-3']);

    local.remote = createKaiRemote({ instanceId: 'laptop-5' });
    local.signal.publish();
    await flushRequests();
    expect(relays.fleet?.members.map((member) => member.id)).toEqual(['laptop-3', 'studio']);
    expect(fleets).toHaveLength(1);

    stop();
    relays.stop();
    expect(relays.fleet).toBeNull();
  });

  it('asks again once the feed goes live or a teammate machine comes online, and not on presence alone', async () => {
    const offline = { ...STUDIO, online: false };
    const local = createLocal(
      createKaiRemote({
        teams: [createTeamEntry({ team: createTeam({ role: 'member', machines: [offline] }) })],
      })
    );
    const feedMachine = {
      teamId: 'team1',
      instanceId: 'studio',
      name: 'Studio',
      userId: MONA.id,
      reason: null,
      updatedAt: 1,
      presence: [],
    };
    local.teams = { machines: [{ ...feedMachine, status: 'connecting' }], tasks: [] };
    const answers: (readonly TeamRelayEntry[])[] = [[], [], [STUDIO_RELAY]];
    let asked = 0;
    const relays = new LocalRelays({
      local,
      origin: ORIGIN,
      createConnection: () => createRelayConnection() as unknown as Connection,
      requestRelays: Effect.sync(() => answers[asked++] ?? []),
      onFleet: () => undefined,
    });
    const stop = relays.start();
    await flushRequests();
    expect(asked).toBe(1);

    local.teams = { machines: [{ ...feedMachine, status: 'live' }], tasks: [] };
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(2);

    local.teams = { machines: [{ ...feedMachine, status: 'live', updatedAt: 2 }], tasks: [] };
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(2);

    local.remote = createKaiRemote();
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(3);
    expect(relays.fleet?.members.map((member) => member.id)).toEqual(['laptop', 'studio']);
    stop();
    relays.stop();
  });

  it('asks again after a failed request, and never asks an engine that cannot relay', async () => {
    const local = createLocal();
    let asked = 0;
    const relays = new LocalRelays({
      local,
      requestRelays: Effect.suspend(() => {
        asked += 1;
        return Effect.fail(new RouteNotFound({ message: 'down' }));
      }),
      onFleet: () => undefined,
    });
    const stop = relays.start();
    await flushRequests();
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(2);
    local.engine = { ...resolveEngineInfo('1.0.0'), features: [] };
    local.signal.publish();
    local.remote = null;
    local.signal.publish();
    await flushRequests();
    expect(asked).toBe(2);
    stop();
  });

  it('switches the page to the fleet and routes its requests through it, and back when it stops', async () => {
    const local = createLocal();
    const requests = answerFetch((request) =>
      Response.json(request.path === '/api/teams/relays' ? { relays: [STUDIO_RELAY] } : {})
    );
    const switched = mock(() => undefined);
    const stop = startLocalRelays(switched, {
      local,
      origin: ORIGIN,
      createConnection: () => createRelayConnection() as unknown as Connection,
    });
    await flushRequests();
    await flushRequests();
    expect(switched).toHaveBeenCalledTimes(1);
    const fleet = connection as Fleet;
    expect(fleet).not.toBe(local);
    expect(fleet.members.map((member) => member.id)).toEqual(['laptop', 'studio']);
    const before = requests.length;
    await runApp(
      Effect.gen(function* () {
        const engine = yield* EngineClient;
        return yield* engine.teams.relays();
      })
    );
    expect(requests.slice(before).map((request) => request.path)).toEqual(['/api/teams/relays']);
    stop();
    expect(connection).not.toBe(fleet);
    const idle = startLocalRelays(switched, { local: createLocal(null) });
    idle();
  });
});
