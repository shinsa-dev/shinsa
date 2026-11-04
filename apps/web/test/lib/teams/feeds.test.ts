import { describe, expect, it, spyOn } from 'bun:test';
import {
  NO_TEAM_FEED,
  SIGNING_KEY_ALGORITHM,
  serializePublicKey,
  signTeamSnapshot,
  TEAM_REFUSALS,
  TEAM_SNAPSHOT_TTL_MS,
  type TeamFeedMachine,
  type TeamMachine,
  type TeamSnapshotBody,
} from '@shinsa/core';
import { Effect } from 'effect';
import {
  describeTeamTaskOwner,
  describeTeamTaskPlace,
  HostedTeamFeeds,
  listHeldTeamMachines,
  describeTeamFeedRefusals,
  listTeamFeedRefusals,
  listHeldTaskIds,
  listFullMachineIds,
  listTeamFeedTasks,
  mergeTeamFeeds,
  resolveFleetTeamTaskPath,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  resolveTeamTaskTarget,
  selectTeamTaskHeldAt,
  TEAM_FEED_REFUSED,
} from '@/lib/teams/feeds.ts';
import type { TeamChannelHandlers, TeamChannelTarget } from '@/lib/teams/team-socket/schema.ts';
import { createGate, createProject, createRepo, createTask } from '../../support/state.ts';
import { createTeam, KAI, MONA } from '../../support/teams.ts';
import { createTeamFeedTask, TEAM_KEY } from './machine.ts';

function createMachine(overrides: Partial<TeamFeedMachine> = {}): TeamFeedMachine {
  return {
    teamId: 'team1',
    instanceId: 'p7m2',
    name: 'Studio',
    userId: '7',
    status: 'live',
    reason: null,
    ...overrides,
  };
}

describe('teammates’ task lists', () => {
  it('merges what each machine watches, keeping the freshest copy of a task and the best status of a machine', () => {
    const older = createTeamFeedTask();
    const newer = createTeamFeedTask({ task: { ...older.task, updatedAt: 20, title: 'Renamed' } });
    const merged = mergeTeamFeeds([
      { machines: [createMachine({ status: 'offline', reason: 'Offline.' })], tasks: [newer] },
      { machines: [createMachine()], tasks: [older] },
    ]);
    expect(merged.machines).toEqual([createMachine()]);
    expect(merged.tasks.map((entry) => entry.task.title)).toEqual(['Renamed']);
    expect(mergeTeamFeeds([NO_TEAM_FEED, NO_TEAM_FEED])).toBe(NO_TEAM_FEED);
  });

  it('keeps the newest snapshot of an offline machine when two feeds hold one', () => {
    const older = createMachine({ status: 'offline', reason: 'Offline.', updatedAt: 10 });
    const newer = createMachine({ status: 'offline', reason: 'Offline.', updatedAt: 20 });
    const bare = createMachine({ status: 'offline', reason: 'Offline.' });
    const merged = mergeTeamFeeds([
      { machines: [older], tasks: [] },
      { machines: [newer], tasks: [] },
      { machines: [bare], tasks: [] },
    ]);
    expect(merged.machines).toEqual([newer]);
  });

  it('notes each refused machine of your teams by name, leaving out live, offline, your own and other teams', () => {
    const feed = {
      machines: [
        createMachine({ instanceId: 'live' }),
        createMachine({ instanceId: 'dialing', status: 'connecting' }),
        createMachine({
          instanceId: 'away',
          name: 'Attic',
          status: 'offline',
          reason: 'Offline.',
          updatedAt: 30,
        }),
        createMachine({ instanceId: 'shut', name: 'Mac.lan', status: 'refused', reason: 'Not listed yet.' }),
        createMachine({ instanceId: 'bare', name: 'Basement', status: 'refused', reason: null }),
        createMachine({ instanceId: 'mine', status: 'refused', reason: 'Gone.' }),
        createMachine({ teamId: 'team2', instanceId: 'other', status: 'offline', reason: 'Offline.' }),
        createMachine({ teamId: 'unknown', instanceId: 'stray', status: 'offline', reason: 'Offline.' }),
      ],
      tasks: [],
    };
    const teams = [
      { id: 'team1', name: 'Platform', team: null },
      { id: 'team2', name: 'Design', team: null },
    ];
    const refusals = listTeamFeedRefusals(feed, teams, new Set(['mine']), null);
    expect(refusals.map((refusal) => [refusal.machine, refusal.team, refusal.reason])).toEqual([
      ['“Basement”', 'Platform', TEAM_FEED_REFUSED],
      ['“Mac.lan”', 'Platform', 'Not listed yet.'],
    ]);
    expect(listTeamFeedRefusals(feed, teams, new Set(), 'team2')).toEqual([]);
  });

  it('names the owner of a refused machine and says when it only needs the team link', () => {
    const team = createTeam({ owner: MONA, members: [{ user: KAI, addedAt: 1 }] });
    const feed = {
      machines: [
        createMachine({
          instanceId: 'jake',
          name: 'Mac.lan',
          userId: KAI.id,
          status: 'refused',
          reason: TEAM_REFUSALS.key,
        }),
      ],
      tasks: [],
    };
    const teams = [{ id: 'team1', name: 'Superwall', team }];
    const refusals = listTeamFeedRefusals(feed, teams, new Set(), null);
    expect(refusals.map(({ owner, needsLink }) => [owner, needsLink])).toEqual([[KAI, true]]);
    expect(describeTeamFeedRefusals(refusals)).toEqual({
      label: ['“Mac.lan”', ' by ', { user: KAI }, ' in Superwall needs the team link'],
      detail: TEAM_REFUSALS.key,
    });
    const quiet = listTeamFeedRefusals(
      {
        machines: [createMachine({ name: 'Attic', userId: 'gone', status: 'refused', reason: 'Gone.' })],
        tasks: [],
      },
      teams,
      new Set(),
      null
    );
    expect(describeTeamFeedRefusals(quiet)).toEqual({
      label: ['“Attic”', ' in Superwall is not listing its tasks'],
      detail: 'Gone.',
    });
    expect(describeTeamFeedRefusals([...refusals, ...quiet])).toEqual({
      label: ['2 teammate machines are not listing their tasks'],
      detail: `“Mac.lan” (Kai): ${TEAM_REFUSALS.key} “Attic”: Gone.`,
    });
    expect(describeTeamFeedRefusals([])).toBeNull();
  });

  it('knows which tasks come from a snapshot, and since when', () => {
    const held = listHeldTeamMachines({
      machines: [
        createMachine({ status: 'offline', reason: 'Offline.', updatedAt: 30 }),
        createMachine({ instanceId: 'live', updatedAt: 40 }),
        createMachine({ instanceId: 'bare', status: 'offline', reason: 'Offline.' }),
      ],
      tasks: [],
    });
    expect(selectTeamTaskHeldAt(held, createTeamFeedTask())).toBe(30);
    expect(selectTeamTaskHeldAt(held, createTeamFeedTask({ instanceId: 'live' }))).toBeNull();
    expect(selectTeamTaskHeldAt(held, createTeamFeedTask({ instanceId: 'bare' }))).toBeNull();
  });

  it('lists the tasks of the teams asked for, open ones first and the newest first, leaving out machines you reach with full control', () => {
    const done = createTeamFeedTask({ task: createTask({ id: 'done', stage: 'merged', updatedAt: 50 }) });
    const recent = createTeamFeedTask({ task: createTask({ id: 'recent', updatedAt: 40 }) });
    const old = createTeamFeedTask({ task: createTask({ id: 'old', updatedAt: 5 }) });
    const otherTeam = createTeamFeedTask({ teamId: 'team2', task: createTask({ id: 'other' }) });
    const reachable = createTeamFeedTask({ instanceId: 'k3x9', task: createTask({ id: 'mine' }) });
    const feed = { machines: [], tasks: [old, done, otherTeam, reachable, recent] };
    const listed = listTeamFeedTasks(feed, new Set(['team1']), new Set(['k3x9']));
    expect(listed.map((entry) => entry.task.id)).toEqual(['recent', 'old', 'done']);
    const both = listTeamFeedTasks(feed, new Set(['team1', 'team2']), new Set());
    expect(both.map((entry) => entry.task.id)).toEqual(['other', 'mine', 'recent', 'old', 'done']);
    const taken = listTeamFeedTasks(feed, new Set(['team1']), new Set(), new Set(['recent']));
    expect(taken.map((entry) => entry.task.id)).toEqual(['mine', 'old', 'done']);
  });

  it('knows which teammate tasks are already among yours, as the ones you took over', () => {
    const tasks = { yours: createTask({ id: 'yours' }), theirs: createTask({ id: 'theirs' }) };
    expect([...listHeldTaskIds({ tasks, teammateTasks: { theirs: true } })]).toEqual(['yours']);
    expect(listHeldTaskIds({ tasks }).size).toBe(0);
    expect(listHeldTaskIds(null).size).toBe(0);
  });

  it('lists a task once when two teams both share it', () => {
    const task = createTask({ id: 'shared' });
    const feed = {
      machines: [],
      tasks: [createTeamFeedTask({ task }), createTeamFeedTask({ teamId: 'team2', task })],
    };
    const listed = listTeamFeedTasks(feed, new Set(['team1', 'team2']), new Set());
    expect(listed.map((entry) => `${entry.teamId}:${entry.task.id}`)).toEqual(['team1:shared']);
  });

  it('opens a teammate’s task at its own address and names whose it is', () => {
    const entry = createTeamFeedTask();
    expect(resolveTeamTaskTarget(entry)).toEqual({ teamId: 'team1', instanceId: 'p7m2', taskId: 'kai-task' });
    expect(resolveTeamTaskPath({ teamId: 'a b', instanceId: 'm', taskId: 't' })).toBe('/teams/a%20b/m/t');
    const task = createTask({ id: 'kai-task', handle: 'LOC-4' });
    const teammate = {
      owner: { id: 'u1', login: 'kai', name: null, avatarUrl: null },
      viewerId: 'u2',
      scopes: [],
    };
    expect(resolveFleetTeamTaskPath(resolveTeamTaskTarget(entry), task, { id: 'p7m2', teammate })).toBe(
      '/tasks/LOC-4'
    );
    expect(
      resolveFleetTeamTaskPath(resolveTeamTaskTarget(entry), task, { id: 'other', teammate })
    ).toBeNull();
    expect(resolveFleetTeamTaskPath(resolveTeamTaskTarget(entry), task, { id: 'p7m2' })).toBeNull();
    expect(resolveFleetTeamTaskPath(resolveTeamTaskTarget(entry), null, null)).toBeNull();
    expect(describeTeamTaskOwner(entry)).toBe('kai');
    expect(describeTeamTaskOwner({ ...entry, ownerProfile: { name: 'Kai Tanaka', avatarUrl: null } })).toBe(
      'Kai'
    );
    expect(describeTeamTaskOwner({ owner: null, machine: 'Studio' })).toBe('Studio');
    expect(describeTeamTaskOwner({ owner: null, machine: null })).toBe('A teammate');
    expect(describeTeamTaskPlace({ machine: 'Studio' })).toBe('On Studio, read-only');
    expect(describeTeamTaskPlace({ machine: null })).toBe('Read-only');
  });

  it('builds a state of just the task, its gates, project and repository, so its status reads as on its own machine', () => {
    const gate = createGate({ id: 'g1', taskId: 'kai-task' });
    const project = createProject({ id: 'p1', name: 'Platform' });
    const repo = createRepo({ id: 'r1', name: 'paywalls' });
    const state = resolveTeamTaskState(createTeamFeedTask({ gates: [gate], project, repo }));
    expect(Object.keys(state.tasks)).toEqual(['kai-task']);
    expect(state.gates).toEqual({ g1: gate });
    expect(state.projects).toEqual({ p1: project });
    expect(state.repos).toEqual({ r1: repo });
    expect(resolveTeamTaskState(createTeamFeedTask()).projects).toEqual({});
    expect(resolveTeamTaskState(createTeamFeedTask()).repos).toEqual({});
  });
});

describe('machines the dashboard reaches in full', () => {
  it('leaves a teammate’s machine out, so its tasks stay listed as theirs', () => {
    const teammate = {
      owner: { id: 'u1', login: 'kai', name: null, avatarUrl: null },
      viewerId: 'u2',
      scopes: [],
    };
    const reachable = listFullMachineIds([{ id: 'studio' }, { id: 'kai', teammate }]);
    expect([...reachable]).toEqual(['studio']);
    const feed = {
      machines: [],
      tasks: [
        createTeamFeedTask({ instanceId: 'kai', task: createTask({ id: 'theirs' }) }),
        createTeamFeedTask({ instanceId: 'studio', task: createTask({ id: 'mine' }) }),
      ],
    };
    expect(listTeamFeedTasks(feed, new Set(['team1']), reachable).map((entry) => entry.task.id)).toEqual([
      'theirs',
    ]);
  });
});

describe('the hosted dashboard’s team feeds', () => {
  function createHosted(
    options: {
      keys?: Record<string, string>;
      failing?: boolean;
      machines?: TeamMachine[];
      now?: () => number;
    } = {}
  ) {
    const opened: { target: TeamChannelTarget; handlers: TeamChannelHandlers; stopped: boolean }[] = [];
    const waits: (() => void)[] = [];
    const delays: number[] = [];
    const team = createTeam({
      machines: options.machines ?? [
        { id: 'p7m2', name: 'Studio', userId: '7', online: true, lastSeenAt: 1 },
        { id: 'q1', name: 'Laptop', userId: '7', online: false, lastSeenAt: 1 },
      ],
    });
    const keys = options.keys ?? { team1: TEAM_KEY };
    const feeds = new HostedTeamFeeds({
      listTeams: () =>
        options.failing
          ? Promise.reject(new Error('offline'))
          : Promise.resolve([team, createTeam({ id: 'team2' })]),
      selectTeamKey: (teamId) =>
        Promise.resolve(keys[teamId] ? { teamId, name: 'Platform', key: keys[teamId], joinedAt: 1 } : null),
      openChannel: (target, handlers) => {
        const entry = { target, handlers, stopped: false };
        opened.push(entry);
        return () => {
          entry.stopped = true;
        };
      },
      wait: (ms, run) => {
        delays.push(ms);
        waits.push(run);
        return () => undefined;
      },
      now: options.now,
    });
    return { feeds, opened, waits, delays };
  }

  it('watches each online machine of every team this browser holds a key for, and publishes its list', async () => {
    const { feeds, opened } = createHosted();
    let published = 0;
    feeds.subscribe(() => {
      published += 1;
    });
    await feeds.start();
    expect(opened.map((entry) => entry.target)).toEqual([
      { teamId: 'team1', instanceId: 'p7m2', key: TEAM_KEY, view: { kind: 'list' } },
    ]);
    expect(feeds.snapshot().machines.map((machine) => [machine.instanceId, machine.status])).toEqual([
      ['p7m2', 'connecting'],
      ['q1', 'offline'],
    ]);
    const task = createTeamFeedTask();
    opened[0]?.handlers.onMessage({ t: 'body', id: 'x', chunk: '' });
    opened[0]?.handlers.onMessage({
      t: 'view',
      data: JSON.stringify({ tasks: [{ ...task, teamId: undefined, instanceId: undefined }], updatedAt: 1 }),
    });
    expect(feeds.snapshot().tasks.map((entry) => [entry.teamId, entry.instanceId, entry.task.id])).toEqual([
      ['team1', 'p7m2', 'kai-task'],
    ]);
    expect(feeds.snapshot().machines[0]?.status).toBe('live');
    expect(published).toBe(2);
  });

  it('tries again after a drop, and a minute after a refusal, since the machine may not know a new member yet', async () => {
    const { feeds, opened, waits, delays } = createHosted();
    await feeds.start();
    opened[0]?.handlers.onEnd({ reason: 'Offline.', gone: false });
    expect(feeds.snapshot().machines[0]).toMatchObject({ status: 'offline', reason: 'Offline.' });
    waits.shift()?.();
    expect(opened).toHaveLength(2);
    opened[1]?.handlers.onEnd({ reason: 'Not in the team.', gone: true });
    expect(feeds.snapshot().machines[0]).toMatchObject({ status: 'refused', reason: 'Not in the team.' });
    expect(delays).toEqual([1_000, 120_000]);
    waits.shift()?.();
    expect(opened).toHaveLength(3);
    opened[2]?.handlers.onMessage({ t: 'view', data: '{"tasks":[]}' });
    expect(feeds.snapshot().machines[0]?.status).toBe('live');
  });

  it('opens nothing without a key or when app.shinsa.dev cannot list the teams, and stops every channel', async () => {
    const bare = createHosted({ keys: {} });
    await bare.feeds.start();
    expect(bare.opened).toEqual([]);
    const failing = createHosted({ failing: true });
    await failing.feeds.start();
    expect(failing.feeds.snapshot()).toBe(NO_TEAM_FEED);
    const { feeds, opened, waits } = createHosted();
    await feeds.start();
    feeds.stop();
    expect(opened[0]?.stopped).toBe(true);
    expect(feeds.snapshot()).toBe(NO_TEAM_FEED);
    opened[0]?.handlers.onMessage({ t: 'view', data: '{"tasks":[]}' });
    opened[0]?.handlers.onEnd({ reason: 'Offline.', gone: false });
    expect(waits).toEqual([]);
  });

  it('waits on the page’s own timer by default, and cancels it when stopped', async () => {
    const timers: number[] = [];
    const scheduled = spyOn(globalThis, 'setTimeout').mockImplementation(((_run: () => void, ms: number) => {
      timers.push(ms);
      return 7;
    }) as unknown as typeof setTimeout);
    const cleared = spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const opened: TeamChannelHandlers[] = [];
    const feeds = new HostedTeamFeeds({
      listTeams: () =>
        Promise.resolve([
          createTeam({
            machines: [{ id: 'p7m2', name: 'Studio', userId: '7', online: true, lastSeenAt: 1 }],
          }),
        ]),
      selectTeamKey: (teamId) => Promise.resolve({ teamId, name: 'Platform', key: TEAM_KEY, joinedAt: 1 }),
      openChannel: (_target, handlers) => {
        opened.push(handlers);
        return () => undefined;
      },
    });
    await feeds.start();
    opened[0]?.onEnd({ reason: 'Offline.', gone: false });
    feeds.stop();
    expect(timers).toEqual([1_000]);
    expect(cleared).toHaveBeenCalledWith(7);
    scheduled.mockRestore();
    cleared.mockRestore();
  });

  it('stops before it opens anything when stopped while the teams load', async () => {
    const { feeds, opened } = createHosted();
    const started = feeds.start();
    feeds.stop();
    await started;
    expect(opened).toEqual([]);
  });

  it('keeps a machine’s last list while it is offline, marked with when it was updated, and drops it on a refusal', async () => {
    const { feeds, opened, waits } = createHosted({ now: () => 100 });
    await feeds.start();
    const task = createTeamFeedTask();
    opened[0]?.handlers.onMessage({ t: 'view', data: JSON.stringify({ tasks: [task], updatedAt: 40 }) });
    opened[0]?.handlers.onEnd({ reason: 'Offline.', gone: false });
    expect(feeds.snapshot().machines[0]).toMatchObject({ status: 'offline', updatedAt: 40 });
    expect(feeds.snapshot().tasks.map((entry) => entry.task.id)).toEqual(['kai-task']);
    waits.shift()?.();
    opened[1]?.handlers.onEnd({ reason: 'Not in the team.', gone: true });
    expect(feeds.snapshot().tasks).toEqual([]);
    expect(feeds.snapshot().machines[0]?.updatedAt).toBeUndefined();
  });

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

  async function createRelayed(options: { now?: () => number; laptopOnline?: boolean } = {}) {
    const laptop = await createSigner();
    const stranger = await createSigner();
    const hosted = createHosted({
      now: options.now ?? (() => 1_000),
      machines: [
        { id: 'p7m2', name: 'Studio', userId: '7', online: true, lastSeenAt: 1 },
        {
          id: 'q1',
          name: 'Laptop',
          userId: '9',
          online: options.laptopOnline ?? false,
          lastSeenAt: 1,
          signingKey: laptop.signingKey,
        },
        { id: 'r2', name: 'Desk', userId: '9', online: false, lastSeenAt: 1 },
      ],
    });
    await hosted.feeds.start();
    const body = (overrides: Partial<TeamSnapshotBody> = {}): TeamSnapshotBody => ({
      teamId: 'team1',
      instanceId: 'q1',
      tasks: [createTeamFeedTask({ task: createTask({ id: 'laptop-task', title: 'Fix the export' }) })],
      updatedAt: 900,
      ...overrides,
    });
    const relay = async (held: unknown[]) => {
      hosted.opened[0]?.handlers.onMessage({
        t: 'view',
        data: JSON.stringify({ tasks: [], updatedAt: 950, held }),
      });
      await Bun.sleep(20);
    };
    return { ...hosted, laptop, stranger, body, relay };
  }

  it('shows an offline machine’s tasks from a teammate’s copy once its own key verifies it', async () => {
    const { feeds, laptop, body, relay } = await createRelayed();
    await relay([await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body()))]);
    expect(feeds.snapshot().tasks.map((entry) => [entry.instanceId, entry.task.id])).toEqual([
      ['q1', 'laptop-task'],
    ]);
    expect(feeds.snapshot().machines[1]).toMatchObject({
      instanceId: 'q1',
      status: 'offline',
      updatedAt: 900,
    });
    await relay([
      await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body({ updatedAt: 800, tasks: [] }))),
    ]);
    expect(feeds.snapshot().tasks).toHaveLength(1);
  });

  it('refuses a copy signed by another key, about another team, of a machine with no key, or too old', async () => {
    const now = 900 + TEAM_SNAPSHOT_TTL_MS + 1;
    const { feeds, laptop, stranger, body, relay } = await createRelayed({ now: () => now });
    const fresh = now - 10;
    await relay([
      await Effect.runPromise(signTeamSnapshot(stranger.privateKey, body({ updatedAt: fresh }))),
      await Effect.runPromise(
        signTeamSnapshot(laptop.privateKey, body({ teamId: 'team2', updatedAt: fresh }))
      ),
      await Effect.runPromise(
        signTeamSnapshot(laptop.privateKey, body({ instanceId: 'r2', updatedAt: fresh }))
      ),
      await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body())),
      { body: 'not json', signature: 'x' },
    ]);
    expect(feeds.snapshot().tasks).toEqual([]);
  });

  it('lets a copy expire 30 days after its machine last updated it', async () => {
    let now = 1_000;
    const { feeds, laptop, body, relay } = await createRelayed({ now: () => now });
    await relay([await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body()))]);
    expect(feeds.snapshot().tasks).toHaveLength(1);
    now = 900 + TEAM_SNAPSHOT_TTL_MS + 1;
    await relay([]);
    expect(feeds.snapshot().tasks).toEqual([]);
    expect(feeds.snapshot().machines[1]?.updatedAt).toBeUndefined();
  });

  it('never lets a copy replace a machine that is live, nor take one once stopped', async () => {
    const { feeds, opened, laptop, body, relay } = await createRelayed({ laptopOnline: true });
    opened[1]?.handlers.onMessage({ t: 'view', data: JSON.stringify({ tasks: [], updatedAt: 500 }) });
    await relay([await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body()))]);
    expect(feeds.snapshot().tasks).toEqual([]);
    opened[1]?.handlers.onEnd({ reason: 'Offline.', gone: false });
    const copy = await Effect.runPromise(signTeamSnapshot(laptop.privateKey, body()));
    opened[0]?.handlers.onMessage({
      t: 'view',
      data: JSON.stringify({ tasks: [], updatedAt: 950, held: [copy] }),
    });
    feeds.stop();
    await Bun.sleep(20);
    expect(feeds.snapshot()).toBe(NO_TEAM_FEED);
  });
});
