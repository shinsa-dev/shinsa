import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_TEAM_PERMISSIONS,
  type RemoteTeam,
  resolveMachineTeamPath,
  serializeBase64Url,
  serializeShareMessage,
  type TeamMachine,
} from '@shinsa/core';
import { Effect, Ref } from 'effect';
import { AccessScope } from '../../src/remote/access/service.ts';
import type { ChannelPeer } from '../../src/remote/channel.ts';
import { RemoteControl } from '../../src/remote/client/index.ts';
import { createRefusedConnector } from '../../src/remote/connector/refused.ts';
import { Remote } from '../../src/remote/index.ts';
import { SHARE_REMOTE_CHANGED, Shares } from '../../src/remote/shares.ts';
import { type FeedSocket, TEAM_FEED_OFFLINE, TeamFeeds } from '../../src/remote/team-feeds.ts';
import { TEAM_REMOTE_CHANGED, Teams } from '../../src/remote/teams.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createStubEngine } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: null, avatarUrl: null };

const LAPTOP: TeamMachine = { id: 'inst2', name: 'Laptop', userId: KAI.id, online: true, lastSeenAt: 1 };

const TEAM: RemoteTeam = {
  id: 'team1',
  name: 'Platform',
  owner: MONA,
  role: 'owner',
  members: [{ user: KAI, addedAt: 2 }],
  requests: [],
  machines: [LAPTOP],
  permissions: DEFAULT_TEAM_PERMISSIONS,
  overrides: [],
  createdAt: 1,
};

const TEAM_KEY = {
  teamId: 'team1',
  name: 'Platform',
  key: serializeBase64Url(new Uint8Array(32).fill(3)),
  invite: null,
  addedAt: 1,
};

const REMOTE_ACCESS_CHANGED = 'Remote access to this machine changed.';

function runAccess<A>(effect: Effect.Effect<A, never, AccessScope>) {
  return Effect.runPromise(effect.pipe(Effect.provide(AccessScope.layer)));
}

describe('AccessScope', () => {
  test('ending closes every lease once and opens a fresh scope for the next one', async () => {
    const closed = await runAccess(
      Effect.gen(function* () {
        const scope = yield* AccessScope;
        const closes = yield* Ref.make<string[]>([]);
        const close = (name: string) => Ref.update(closes, (names) => [...names, name]);
        const before = yield* scope.isOpen;
        yield* scope.acquire(close('app'));
        const share = yield* scope.acquire(close('share'));
        yield* share.release;
        yield* share.release;
        const during = yield* scope.isOpen;
        yield* scope.end;
        yield* scope.end;
        const after = yield* scope.isOpen;
        yield* scope.acquire(close('feed'));
        yield* scope.end;
        return { names: yield* Ref.get(closes), before, during, after };
      })
    );
    expect(closed).toEqual({ names: ['share', 'app', 'feed'], before: false, during: true, after: false });
  });
});

let running: FakeControlPlane | null = null;

afterEach(async () => {
  await running?.stop();
  running = null;
});

interface RecordedPeer extends ChannelPeer {
  sent: unknown[];
  closes: { code: number; reason: string }[];
}

function createPeer(): RecordedPeer {
  const peer: RecordedPeer = {
    sent: [],
    closes: [],
    send: (data) => peer.sent.push(data),
    close: (code, reason) => peer.closes.push({ code, reason }),
  };
  return peer;
}

interface FakeFeedSocket extends FeedSocket {
  closed: boolean;
}

function setUp() {
  const plane = startFakeControlPlane();
  running = plane;
  plane.answers.set(resolveMachineTeamPath('team1', 'connect'), () =>
    Response.json({ url: 'wss://t-inst2.shinsa.dev/team?token=t', expiresAt: 1 })
  );
  const path = join(createTempDir(), 'remote.json');
  writeFileSync(
    path,
    JSON.stringify({
      credentials: {
        instanceId: 'inst1',
        machineToken: 'machine-token',
        tunnelToken: 'tunnel',
        tunnelHost: 't-inst1.shinsa.dev',
        connectKey: 'key',
      },
      enabled: true,
      owner: 'mona',
      access: { owner: MONA, members: [] },
      teams: [TEAM],
      teamKeys: [TEAM_KEY],
    })
  );
  const remote = new Remote({
    path,
    control: new RemoteControl({ origin: plane.origin }),
    connector: createRefusedConnector('no tunnel in this test'),
    localUrl: () => 'http://127.0.0.1:1',
    version: '1',
    maxBodyBytes: 1024,
    machineName: 'Studio',
    openUrl: () => Promise.resolve(),
  });
  const { engine } = createStubEngine();
  const transcripts = { listEntries: () => [], subscribe: () => () => undefined };
  const shares = new Shares({ engine, remote, evidence: {} as never, transcripts });
  const teams = new Teams({ engine, remote, shares, transcripts });
  const sockets: FakeFeedSocket[] = [];
  const feeds = new TeamFeeds({
    remote,
    createSocket: () => {
      const socket: FakeFeedSocket = {
        binaryType: 'blob',
        closed: false,
        send: () => undefined,
        close: () => {
          socket.closed = true;
        },
        addEventListener: () => undefined,
      };
      sockets.push(socket);
      return socket;
    },
    wait: () => () => undefined,
  });
  return { remote, shares, teams, feeds, sockets };
}

describe('ending remote access', () => {
  test('turning remote access off closes the app, share and team channels and every team feed', async () => {
    const { remote, shares, teams, feeds, sockets } = setUp();
    const parts = {
      hub: { open: () => undefined, close: () => undefined, message: () => undefined },
      terminals: null,
    };
    const respond = () => Promise.resolve(new Response(null));
    const appPeer = createPeer();
    remote.openChannel(appPeer, { ...parts, respond }, MONA.id);
    const leftPeer = createPeer();
    remote.closeChannel(remote.openChannel(leftPeer, { ...parts, respond }, MONA.id));
    const sharePeer = createPeer();
    shares.openChannel(sharePeer, 'share-1');
    const teamPeer = createPeer();
    teams.openChannel(teamPeer, KAI.id);
    feeds.start();
    await until('the feed socket', () => sockets.length === 1);
    const relayPeer = createPeer();
    feeds.openRelay(relayPeer, { teamId: 'team1', instanceId: 'inst2', taskId: 'task-1' });
    await until('the relay socket', () => sockets.length === 2);
    expect(remote.access.isOpen).toBe(true);

    await remote.disable();

    expect(appPeer.closes).toEqual([{ code: 1008, reason: REMOTE_ACCESS_CHANGED }]);
    expect(leftPeer.closes).toEqual([]);
    expect(sharePeer.closes).toEqual([{ code: 1000, reason: SHARE_REMOTE_CHANGED }]);
    expect(teamPeer.closes).toEqual([{ code: 1000, reason: TEAM_REMOTE_CHANGED }]);
    expect(relayPeer.closes).toEqual([{ code: 1000, reason: TEAM_FEED_OFFLINE }]);
    expect(relayPeer.sent).toEqual([serializeShareMessage({ t: 'closed', reason: TEAM_FEED_OFFLINE })]);
    expect(sockets.map((socket) => socket.closed)).toEqual([true, true]);
    expect(remote.access.isOpen).toBe(false);
    feeds.stop();
  });
});
