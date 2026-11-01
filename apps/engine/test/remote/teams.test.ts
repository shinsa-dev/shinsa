import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Bytes,
  createFrameOpener,
  createTeamHello,
  decodeText,
  deriveTeamSessionKey,
  parseShareMessage,
  parseShareWelcome,
  REMOTE_PATHS,
  type RemoteTeam,
  resolveMachineTeamPath,
  resolveTeamJoinUrl,
  type ShareMessage,
  type ShinsaState,
  serializeBase64Url,
  type TeamListView,
  type TeamSnapshot,
  type TeamView,
  verifyTeamSnapshot,
} from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import { TEAM_GONE_REASON, TEAM_REMOTE_CHANGED, Teams, type TeamsOptions } from '../../src/remote/teams.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';
import { createKeyPair, startHandshake } from './client.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const CREDENTIALS = {
  instanceId: 'inst1',
  machineToken: 'machine-token',
  tunnelToken: 'tunnel',
  tunnelHost: 't-inst1.shinsa.dev',
  connectKey: 'key',
};

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: null, avatarUrl: null };

const BOB = { id: '9', login: 'bob', name: null, avatarUrl: null };

const TEAM_KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const GRANT_SECRET = serializeBase64Url(new Uint8Array(32).fill(8));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(4));

const LIST: TeamView = { kind: 'list' };

const TASK_VIEW: TeamView = { kind: 'task', taskId: 'task-1' };

function createTeam(overrides: Partial<RemoteTeam> = {}): RemoteTeam {
  return {
    id: 'team1',
    name: 'Platform',
    owner: MONA,
    role: 'owner',
    members: [{ user: KAI, addedAt: 2 }],
    requests: [{ user: BOB, addedAt: 3 }],
    machines: [],
    createdAt: 1,
    ...overrides,
  };
}

const STORED_KEY = { teamId: 'team1', name: 'Platform', key: TEAM_KEY, invite: 'invite-1', addedAt: 1 };

let running: FakeControlPlane | null = null;

afterEach(async () => {
  await running?.stop();
  running = null;
});

interface SetUp {
  file?: Record<string, unknown>;
  patch?: (state: ShinsaState) => void;
  resolveLive?: () => Promise<never>;
  held?: TeamsOptions['held'];
}

function setUp(options: SetUp = {}) {
  const plane = startFakeControlPlane();
  running = plane;
  const path = join(createTempDir(), 'remote.json');
  writeFileSync(
    path,
    JSON.stringify({
      credentials: CREDENTIALS,
      enabled: true,
      owner: 'mona',
      access: { owner: MONA, members: [] },
      teams: [createTeam()],
      teamKeys: [STORED_KEY],
      ...options.file,
    })
  );
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
    state.tasks['task-2'] = createTask({ id: 'task-2', repoId: null, activity: [] });
    options.patch?.(state);
  });
  const live = { view: { live: true }, files: [] };
  const transcriptListeners: ((runId: string) => void)[] = [];
  const teams = new Teams({
    engine: stub.engine,
    remote,
    shares: { resolveLive: options.resolveLive ?? (() => Promise.resolve(live as never)) },
    transcripts: {
      subscribe: (listener) => {
        transcriptListeners.push(listener);
        return () => undefined;
      },
    },
    ...(options.held ? { held: options.held } : {}),
    now: () => 50,
    random: (bytes) => new Uint8Array(bytes).fill(6),
  });
  const writeTranscript = (runId: string) => {
    for (const listener of transcriptListeners) listener(runId);
  };
  return { plane, stub, remote, teams, path, writeTranscript };
}

interface Viewer {
  messages: ShareMessage[];
  closed: { code: number; reason: string } | null;
  refused: string | null;
  views: () => unknown[];
  send: (data: string) => Promise<void>;
}

async function openViewer(teams: Teams, userId: string, view: TeamView, key = TEAM_KEY): Promise<Viewer> {
  const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const hello = await createTeamHello('team1', key, view, ephemeral.publicKey);
  let open: ((frame: Bytes) => Promise<Bytes>) | null = null;
  let queue: Promise<void> = Promise.resolve();
  const viewer: Viewer = {
    messages: [],
    closed: null,
    refused: null,
    views: () =>
      viewer.messages.flatMap((message) => (message.t === 'view' ? [JSON.parse(message.data)] : [])),
    send: (data) => channel.receive(data),
  };
  const channel = teams.openChannel(
    {
      send: (data) => {
        queue = queue.then(async () => {
          if (typeof data === 'string') {
            const welcome = parseShareWelcome(data);
            if (welcome?.type === 'refused') viewer.refused = welcome.reason;
            if (welcome?.type !== 'welcome') return;
            const keys = {
              team: 'team1',
              view,
              clientEphemeral: hello.ephemeral,
              serverEphemeral: welcome.ephemeral,
            };
            open = createFrameOpener(
              await deriveTeamSessionKey(key, keys, ephemeral.privateKey, welcome.ephemeral)
            );
            return;
          }
          if (!open) throw new Error('a frame before the welcome');
          const message = parseShareMessage(decodeText(await open(data as Bytes)));
          if (message) viewer.messages.push(message);
        });
      },
      close: (code, reason) => {
        viewer.closed = { code, reason };
      },
    },
    userId
  );
  await channel.receive(JSON.stringify(hello));
  await queue;
  return viewer;
}

describe('a team view of this machine', () => {
  test('a member who holds the key sees the team task list, redacted, with whose tasks they are', async () => {
    const { teams, remote } = setUp();
    expect(teams.acceptsViewer()).toBe(true);
    const viewer = await openViewer(teams, KAI.id, LIST);
    expect(viewer.refused).toBeNull();
    const [view] = viewer.views() as TeamListView[];
    expect(view?.tasks.map((task) => task.task.id)).toEqual(['task-1']);
    expect(view?.tasks[0]).toMatchObject({
      owner: 'mona',
      ownerProfile: { name: 'Mona Lisa', avatarUrl: null },
      machine: 'Studio',
      project: { id: 'p1' },
    });
    expect(view?.updatedAt).toBe(50);
    expect(view?.machineKey).toBe((await remote.store.resolveMachineKey()).publicKey);
    expect(view?.grant).toBeUndefined();
  });

  test('the list carries a snapshot this machine signed, which its signing key verifies', async () => {
    const { teams, remote } = setUp();
    const [view] = (await openViewer(teams, KAI.id, LIST)).views() as TeamListView[];
    const { publicKey } = await remote.store.resolveSigningKey();
    if (!view?.snapshot) throw new Error('The list view carries no snapshot');
    const body = await verifyTeamSnapshot(publicKey, view.snapshot);
    expect(body).toEqual({
      teamId: 'team1',
      instanceId: CREDENTIALS.instanceId,
      tasks: view.tasks,
      updatedAt: 50,
    });
  });

  test('a machine with no credentials signs nothing, since no teammate could tell which machine it is', async () => {
    const { teams } = setUp({ file: { credentials: null } });
    const [view] = (await openViewer(teams, KAI.id, LIST)).views() as TeamListView[];
    expect(view?.tasks.length).toBe(1);
    expect(view?.snapshot).toBeUndefined();
  });

  test('passes on the lists it keeps of the team’s offline machines, and pushes the list when they change', async () => {
    const kept = { body: '{"instanceId":"inst3"}', signature: 'sig' };
    let held: TeamSnapshot[] = [];
    const heldListeners: (() => void)[] = [];
    const { teams } = setUp({
      held: {
        listHeld: (teamId) => (teamId === 'team1' ? held : []),
        subscribeHeld: (listener) => {
          heldListeners.push(listener);
          return () => true;
        },
      },
    });
    const list = await openViewer(teams, KAI.id, LIST);
    const task = await openViewer(teams, KAI.id, TASK_VIEW);
    expect((list.views()[0] as TeamListView).held).toBeUndefined();
    held = [kept];
    for (const listener of heldListeners) listener();
    await until('the list is pushed again', () => list.views().length === 2);
    expect((list.views().at(-1) as TeamListView).held).toEqual([kept]);
    expect(task.views()).toHaveLength(1);
  });

  test('sends a grant’s secret only to the teammate it was given to, in that team', async () => {
    const { teams } = setUp({
      file: { grants: [{ userId: KAI.id, teamId: 'team1', secret: GRANT_SECRET }] },
    });
    const [kai] = (await openViewer(teams, KAI.id, LIST)).views() as TeamListView[];
    const [mona] = (await openViewer(teams, MONA.id, LIST)).views() as TeamListView[];
    expect(kai?.grant).toBe(GRANT_SECRET);
    expect(mona?.grant).toBeUndefined();
  });

  test('a task view streams the task the way a share link does', async () => {
    const { teams } = setUp();
    const viewer = await openViewer(teams, MONA.id, TASK_VIEW);
    expect(viewer.views()).toEqual([{ live: true }]);
  });

  test('a task view is pushed again when one of its runs writes to its transcript, and no other is', async () => {
    let pushes = 0;
    const { teams, writeTranscript } = setUp({
      patch: (state) => {
        state.runs['run-1'] = { id: 'run-1', taskId: 'task-1' } as never;
        state.runs['run-2'] = { id: 'run-2', taskId: 'task-2' } as never;
      },
      resolveLive: () => {
        pushes += 1;
        return Promise.resolve({ view: { push: pushes }, files: [] } as never);
      },
    });
    const viewer = await openViewer(teams, MONA.id, TASK_VIEW);
    const list = await openViewer(teams, MONA.id, LIST);
    const listed = list.views().length;
    writeTranscript('run-2');
    writeTranscript('gone');
    writeTranscript('run-1');
    await until('the view is pushed again', () => viewer.views().length === 2);
    expect(viewer.views()).toEqual([{ push: 1 }, { push: 2 }]);
    expect(list.views()).toHaveLength(listed);
  });

  test('refuses anyone outside the team, a wrong key, a task outside its projects and a team without a key', async () => {
    const { teams } = setUp({ file: { teamKeys: [STORED_KEY] } });
    expect((await openViewer(teams, BOB.id, LIST)).refused).toBe(TEAM_GONE_REASON);
    expect((await openViewer(teams, KAI.id, LIST, OTHER_KEY)).refused).toBe(TEAM_GONE_REASON);
    expect((await openViewer(teams, KAI.id, { kind: 'task', taskId: 'task-2' })).refused).toBe(
      TEAM_GONE_REASON
    );
    expect((await openViewer(teams, KAI.id, { kind: 'task', taskId: 'nope' })).refused).toBe(
      TEAM_GONE_REASON
    );
    const keyless = setUp({ file: { teamKeys: [] } });
    expect((await openViewer(keyless.teams, KAI.id, LIST)).refused).toBe(TEAM_GONE_REASON);
  });

  test('closes on anything but a hello, and on anything sent after it', async () => {
    const { teams } = setUp();
    const peer = {
      closed: '',
      send: () => undefined,
      close: (_code: number, reason: string) => (peer.closed = reason),
    };
    await teams.openChannel(peer, KAI.id).receive('{"type":"share-hello"}');
    expect(peer.closed).toBe('The team view expects a hello first.');
    const viewer = await openViewer(teams, KAI.id, LIST);
    await viewer.send('{"t":"view"}');
    expect(viewer.closed?.reason).toBe('A team view only listens.');
  });

  test('pushes the list again when a task changes, and ends a task view once its project leaves the team', async () => {
    const { teams, stub } = setUp();
    const list = await openViewer(teams, KAI.id, LIST);
    const task = await openViewer(teams, KAI.id, TASK_VIEW);
    stub.state.tasks['task-3'] = createTask({ id: 'task-3', repoId: 'repo-1', activity: [] });
    stub.notify();
    await until('the list is pushed again', () => list.views().length === 2);
    expect((list.views().at(-1) as TeamListView).tasks.map((entry) => entry.task.id)).toEqual([
      'task-1',
      'task-3',
    ]);
    if (stub.state.projects.p1) stub.state.projects.p1.teamIds = [];
    stub.notify();
    await until('the task view ends', () => task.closed !== null);
    await until('the empty list is pushed', () => list.views().length === 3);
    expect(task.closed?.reason).toBe(TEAM_GONE_REASON);
    expect(list.closed).toBeNull();
    expect((list.views().at(-1) as TeamListView).tasks).toEqual([]);
  });

  test('ends the views of a member the owner removes, and every view when remote access is paused', async () => {
    const { teams, plane, remote } = setUp();
    const kai = await openViewer(teams, KAI.id, LIST);
    const mona = await openViewer(teams, MONA.id, LIST);
    await teams.removeMember('team1', KAI.id);
    await until('Kai’s view ends', () => kai.closed !== null);
    expect(kai.closed?.reason).toBe(TEAM_GONE_REASON);
    expect(mona.closed).toBeNull();
    expect(plane.calls.at(-1)).toMatchObject({
      path: resolveMachineTeamPath('team1', 'members/remove'),
      body: { userId: KAI.id },
    });
    await remote.disable();
    await until('Mona’s view ends', () => mona.closed !== null);
    expect(mona.closed?.reason).toBe(TEAM_REMOTE_CHANGED);
    expect(teams.acceptsViewer()).toBe(false);
  });

  test('logs a view it could not close cleanly', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { teams, remote } = setUp();
    const channel = teams.openChannel(
      {
        send: (data) => {
          if (typeof data !== 'string') throw new Error('the socket is gone');
        },
        close: () => undefined,
      },
      KAI.id
    );
    const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    await channel.receive(
      JSON.stringify(await createTeamHello('team1', TEAM_KEY, LIST, ephemeral.publicKey))
    );
    teams.closeChannel(channel);
    const other = teams.openChannel({ send: () => undefined, close: () => undefined }, KAI.id);
    await other.receive(JSON.stringify(await createTeamHello('team1', TEAM_KEY, LIST, ephemeral.publicKey)));
    spyOn(other, 'end').mockImplementation(() => Promise.reject(new Error('closed twice')));
    await remote.disable();
    await until('the failure is logged', () => warn.mock.calls.length > 0);
    warn.mockRestore();
  });
});

describe('making and joining teams', () => {
  test('a new team gets a key only this machine holds, and a join link with it in the fragment', async () => {
    const { teams, plane, remote, path } = setUp({ file: { teams: [], teamKeys: [] } });
    const team = createTeam({ id: 'team2', name: 'Growth', members: [], requests: [] });
    plane.answers.set(REMOTE_PATHS.machineTeams, () => Response.json({ team, invite: 'invite-2' }));
    expect(await teams.create('  Growth ')).toBe('team2');
    expect(plane.calls.at(-1)).toMatchObject({ token: 'machine-token', body: { name: 'Growth' } });
    const key = serializeBase64Url(new Uint8Array(32).fill(6));
    expect(await teams.resolveJoinUrl('team2')).toBe(
      resolveTeamJoinUrl({ teamId: 'team2', invite: 'invite-2', key }, plane.origin)
    );
    expect(remote.snapshot().teams).toEqual([
      { id: 'team2', name: 'Growth', status: 'member', onMachine: true, invite: true, team },
    ]);
    expect(JSON.stringify(remote.snapshot())).not.toContain(key);
    expect(readFileSync(path, 'utf8')).toContain(key);
  });

  test('refuses a team without a name, one too many and a machine that is not paired', async () => {
    const { teams, plane } = setUp();
    await expect(teams.create(' ')).rejects.toMatchObject({ code: 'name_invalid' });
    plane.answers.set(REMOTE_PATHS.machineTeams, () => new Response('full', { status: 409 }));
    await expect(teams.create('More')).rejects.toMatchObject({ code: 'teams_full' });
    plane.answers.set(REMOTE_PATHS.machineTeams, () => new Response('down', { status: 500 }));
    await expect(teams.create('More')).rejects.toThrow('status 500');
    const unpaired = setUp({ file: { credentials: null } });
    await expect(unpaired.teams.create('Growth')).rejects.toMatchObject({ code: 'remote_not_paired' });
  });

  test('joining asks the owner and keeps the key; a member is refreshed at once', async () => {
    const { teams, plane, remote } = setUp({ file: { teams: [], teamKeys: [] } });
    const url = resolveTeamJoinUrl({ teamId: 'team1', invite: 'invite-1', key: TEAM_KEY }, plane.origin);
    plane.answers.set(REMOTE_PATHS.machineTeamJoin, () =>
      Response.json({ teamId: 'team1', name: 'Platform', owner: KAI, status: 'requested' })
    );
    expect(await teams.join(url)).toEqual({ status: 'requested', teamId: 'team1' });
    expect(plane.calls.at(-1)?.body).toEqual({ invite: 'invite-1' });
    expect(remote.snapshot().teams).toEqual([
      { id: 'team1', name: 'Platform', status: 'requested', onMachine: true, invite: false, team: null },
    ]);
    plane.answers.set(REMOTE_PATHS.machineTeamJoin, () =>
      Response.json({ teamId: 'team1', name: 'Platform', owner: MONA, status: 'member' })
    );
    const heartbeat = spyOn(remote.supervisor, 'requestHeartbeat').mockResolvedValue();
    expect(await teams.join(url)).toEqual({ status: 'member', teamId: 'team1' });
    expect(heartbeat).toHaveBeenCalled();
    expect(remote.store.selectTeamKey('team1')).toMatchObject({ invite: 'invite-1', key: TEAM_KEY });
  });

  test('refuses a link that is not a team link, one turned off and one for another team', async () => {
    const { teams, plane } = setUp();
    await expect(teams.join('https://app.shinsa.dev/share/team#nope')).rejects.toMatchObject({
      code: 'team_link_invalid',
    });
    const url = resolveTeamJoinUrl({ teamId: 'team1', invite: 'invite-1', key: TEAM_KEY }, plane.origin);
    plane.answers.set(REMOTE_PATHS.machineTeamJoin, () => new Response('gone', { status: 404 }));
    await expect(teams.join(url)).rejects.toMatchObject({ code: 'team_link_off' });
    plane.answers.set(REMOTE_PATHS.machineTeamJoin, () =>
      Response.json({ teamId: 'other', name: 'Other', owner: KAI, status: 'member' })
    );
    await expect(teams.join(url)).rejects.toMatchObject({ code: 'team_link_invalid' });
  });

  test('the owner renews or turns off the link; a member cannot', async () => {
    const { teams, plane, remote } = setUp({
      file: { teamKeys: [{ ...STORED_KEY, invite: null }] },
    });
    plane.answers.set(resolveMachineTeamPath('team1', 'invite'), () => Response.json({ invite: 'invite-3' }));
    expect(await teams.resolveJoinUrl('team1')).toContain('.invite-3.');
    await teams.turnOffInvite('team1');
    expect(remote.store.selectTeamKey('team1')?.invite).toBeNull();
    expect(remote.snapshot().teams[0]?.invite).toBe(false);
    const member = setUp({ file: { teams: [createTeam({ role: 'member' })] } });
    await expect(member.teams.resolveJoinUrl('team1')).rejects.toMatchObject({ code: 'not_owner' });
    await expect(member.teams.renewInvite('team1')).rejects.toMatchObject({ code: 'not_owner' });
    const keyless = setUp({ file: { teamKeys: [] } });
    await expect(keyless.teams.resolveJoinUrl('team1')).rejects.toMatchObject({ code: 'team_key_missing' });
    await expect(keyless.teams.resolveJoinUrl('none')).rejects.toMatchObject({ code: 'team_not_found' });
  });
});

describe('the members of a team', () => {
  test('the owner accepts or declines who asked, and the snapshot follows at once', async () => {
    const { teams, plane, remote } = setUp();
    plane.answers.set(resolveMachineTeamPath('team1', 'members/add'), () =>
      Response.json({ user: BOB, addedAt: 9 })
    );
    await teams.acceptRequest('team1', BOB.id);
    const team = remote.snapshot().teams[0]?.team;
    expect(team?.members.map((member) => member.user.login)).toEqual(['kai', 'bob']);
    expect(team?.requests).toEqual([]);
    const declined = setUp();
    await declined.teams.declineRequest('team1', BOB.id);
    expect(declined.plane.calls.at(-1)?.path).toBe(resolveMachineTeamPath('team1', 'requests/decline'));
    expect(declined.remote.snapshot().teams[0]?.team?.requests).toEqual([]);
  });

  test('says why accepting failed, and refuses to remove someone not in the team', async () => {
    const { teams, plane } = setUp();
    const path = resolveMachineTeamPath('team1', 'members/add');
    plane.answers.set(path, () => new Response('full', { status: 409 }));
    await expect(teams.acceptRequest('team1', BOB.id)).rejects.toMatchObject({ code: 'members_full' });
    plane.answers.set(path, () => new Response('none', { status: 404 }));
    await expect(teams.acceptRequest('team1', BOB.id)).rejects.toMatchObject({ code: 'request_not_found' });
    plane.answers.set(path, () => new Response('owner', { status: 403 }));
    await expect(teams.acceptRequest('team1', BOB.id)).rejects.toMatchObject({ code: 'not_owner' });
    await expect(teams.removeMember('team1', BOB.id)).rejects.toMatchObject({ code: 'member_not_found' });
  });

  test('leaving forgets the key and takes the team off every project, even when the cloud forgot it first', async () => {
    const { teams, plane, remote, stub } = setUp({ file: { teams: [createTeam({ role: 'member' })] } });
    plane.answers.set(resolveMachineTeamPath('team1', 'leave'), () => new Response('gone', { status: 404 }));
    await teams.leave('team1');
    expect(remote.snapshot().teams).toEqual([]);
    expect(remote.store.selectTeamKey('team1')).toBeNull();
    expect(stub.dispatched).toContainEqual({
      type: 'project.remove_from_team',
      projectId: 'p1',
      teamId: 'team1',
    });
    await expect(teams.leave('team1')).rejects.toMatchObject({ code: 'team_not_found' });
  });

  test('a request still waiting can be withdrawn; the owner removes the team instead of leaving it', async () => {
    const pending = setUp({ file: { teams: [] } });
    await pending.teams.leave('team1');
    expect(pending.remote.snapshot().teams).toEqual([]);
    const { teams, plane } = setUp();
    await expect(teams.leave('team1')).rejects.toMatchObject({ code: 'owner_cannot_leave' });
    await teams.remove('team1');
    expect(plane.calls.at(-1)?.path).toBe(resolveMachineTeamPath('team1', 'remove'));
    const failing = setUp();
    failing.plane.answers.set(
      resolveMachineTeamPath('team1', 'remove'),
      () => new Response('x', { status: 500 })
    );
    await expect(failing.teams.remove('team1')).rejects.toThrow('status 500');
    expect(failing.remote.store.selectTeamKey('team1')).not.toBeNull();
  });
});

describe('the heartbeat’s teams', () => {
  test('keep the keys of teams still listed or still asked for, and forget the ones that left the list', () => {
    const { remote } = setUp({
      file: {
        teamKeys: [STORED_KEY, { ...STORED_KEY, teamId: 'asked', name: 'Asked' }],
      },
    });
    expect(remote.store.recordTeams([createTeam({ name: 'Platform team' })])).toBe(true);
    expect(remote.store.file.teamKeys.map((stored) => [stored.teamId, stored.name])).toEqual([
      ['team1', 'Platform team'],
      ['asked', 'Asked'],
    ]);
    expect(remote.store.recordTeams([createTeam({ name: 'Platform team' })])).toBe(false);
    remote.store.recordTeams([]);
    expect(remote.store.file.teamKeys.map((stored) => stored.teamId)).toEqual(['asked']);
  });
});

async function knock(remote: Remote, userId: string, secret: string) {
  const machine = await remote.store.resolveMachineKey();
  const device = await createKeyPair();
  const start = await startHandshake({
    machineKey: machine.publicKey,
    device,
    enrollSecret: secret,
    name: 'Kai’s browser',
  });
  const sent: string[] = [];
  const channel = remote.openChannel(
    { send: (data) => void (typeof data === 'string' && sent.push(data)), close: () => undefined },
    {
      hub: { open: () => undefined, close: () => undefined, message: () => undefined },
      respond: () => Promise.resolve(new Response()),
    },
    userId
  );
  await channel.receive(start.hello);
  await until('the machine answers', () => sent.length > 0);
  return JSON.parse(sent[0] ?? '{}') as { type: string; reason?: string };
}

describe('machine access for a teammate', () => {
  test('a teammate is made a member without asking, and their browser with the team key gets in at once', async () => {
    const { remote, plane } = setUp();
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => Response.json({ user: KAI, addedAt: 9 }));
    expect((await knock(remote, KAI.id, TEAM_KEY)).type).toBe('refused');
    await remote.grantTeammate(KAI.id, 'team1');
    expect(plane.calls.at(-1)).toMatchObject({
      path: REMOTE_PATHS.machineMemberAdd,
      body: { userId: KAI.id },
    });
    expect(remote.snapshot().access?.members).toEqual([{ user: KAI, addedAt: 9 }]);
    const [grant] = remote.store.file.grants;
    expect(grant).toMatchObject({ userId: KAI.id, teamId: 'team1' });
    expect((await knock(remote, KAI.id, TEAM_KEY)).type).toBe('refused');
    expect((await knock(remote, KAI.id, grant?.secret ?? '')).type).toBe('welcome');
    expect(remote.snapshot().devices).toMatchObject([{ name: 'Kai’s browser', userId: KAI.id }]);
  });

  test('a wrong secret, someone else, or a teammate who left gets no device added', async () => {
    const { remote, plane } = setUp();
    plane.answers.set(REMOTE_PATHS.machineMemberAdd, () => Response.json({ user: KAI, addedAt: 9 }));
    await remote.grantTeammate(KAI.id, 'team1');
    const secret = remote.store.file.grants[0]?.secret ?? '';
    expect((await knock(remote, KAI.id, OTHER_KEY)).type).toBe('refused');
    expect((await knock(remote, BOB.id, secret)).type).toBe('refused');
    remote.store.recordTeams([createTeam({ members: [] })]);
    expect((await knock(remote, KAI.id, secret)).type).toBe('refused');
    expect(remote.snapshot().devices).toEqual([]);
  });

  test('a member already keeps their place; removing them takes the grant away too', async () => {
    const { remote, plane } = setUp({
      file: { access: { owner: MONA, members: [{ user: KAI, addedAt: 2 }] } },
    });
    await remote.grantTeammate(KAI.id, 'team1');
    expect(plane.calls.some((call) => call.path === REMOTE_PATHS.machineMemberAdd)).toBe(false);
    await remote.removeMember(KAI.id);
    expect(remote.store.file.grants).toEqual([]);
  });

  test('refuses a team this machine has no key for, someone outside it, and the owner', async () => {
    const { remote } = setUp();
    await expect(remote.grantTeammate(KAI.id, 'other')).rejects.toThrow('This machine is not in that team.');
    await expect(remote.grantTeammate(BOB.id, 'team1')).rejects.toThrow('No one else in that team');
    await expect(remote.grantTeammate(MONA.id, 'team1')).rejects.toThrow('No one else in that team');
  });
});
