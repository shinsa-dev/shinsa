import { describe, expect, test } from 'bun:test';
import type { Initiative, InitiativeTeamMember, Task, TeamFeedSnapshot, TeamFeedTask } from '@shinsa/core';
import { Effect, Layer, type Scope } from 'effect';
import { TeamMembers } from '../../../src/initiatives/team-members/service.ts';
import {
  listTeamMembersUpdates,
  resolveTeamMembersId,
} from '../../../src/initiatives/team-members/updates.ts';
import { JsonLogger } from '../../../src/log/service.ts';
import { RemoteStore } from '../../../src/remote/store/service.ts';
import { TeamFeeds } from '../../../src/remote/team-feeds/service.ts';
import { createStubEngineCoreLayer } from '../../helpers/engine-core.ts';
import { captureLogs } from '../../helpers/logs.ts';
import { createStubEngine, type StubEngine } from '../../helpers/state.ts';

const SELF = 'studio';

function createInitiative(patch: Partial<Initiative> = {}): Initiative {
  return {
    id: 'chat',
    name: 'Chat split',
    description: '',
    phases: [{ id: 'p1', name: 'Session' }],
    leadTaskId: 'lead',
    createdAt: 0,
    updatedAt: 0,
    teamIds: ['team-1'],
    ...patch,
  };
}

function createFeedTask(id: string, patch: Partial<TeamFeedTask> = {}): TeamFeedTask {
  return {
    task: { id, handle: `KAI-${id}`, title: `Task ${id}`, stage: 'building' } as Task,
    gates: [],
    project: null,
    repo: null,
    owner: 'kai',
    machine: 'Laptop',
    initiative: { instanceId: SELF, initiativeId: 'chat', phaseId: 'p1' },
    teamId: 'team-1',
    instanceId: 'laptop',
    ...patch,
  } as TeamFeedTask;
}

const MEMBER: InitiativeTeamMember = {
  teamId: 'team-1',
  instanceId: 'laptop',
  taskId: 't1',
  handle: 'KAI-t1',
  title: 'Task t1',
  owner: 'kai',
  stage: 'building',
  phaseId: 'p1',
  gate: null,
  closedAt: null,
};

function createFeed(tasks: TeamFeedTask[]): TeamFeedSnapshot {
  return { machines: [], tasks };
}

describe('teammates’ tasks in an initiative', () => {
  test('lists the teammates’ tasks that joined a shared initiative of this machine', () => {
    const stub = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative() };
    });
    const feed = createFeed([
      createFeedTask('t1'),
      createFeedTask('t2', { initiative: { instanceId: 'other', initiativeId: 'chat', phaseId: null } }),
      createFeedTask('t3', { teamId: 'team-2' }),
    ]);
    expect(listTeamMembersUpdates(stub.state, SELF, feed)).toEqual([
      { initiativeId: 'chat', teamId: 'team-1', previous: [], members: [MEMBER] },
    ]);
  });

  test('sends nothing when the members are the ones already recorded, or the initiative has no lead', () => {
    const recorded = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative({ teamMembers: [MEMBER] }) };
    });
    expect(listTeamMembersUpdates(recorded.state, SELF, createFeed([createFeedTask('t1')]))).toEqual([]);
    const leaderless = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative({ leadTaskId: null }) };
    });
    expect(listTeamMembersUpdates(leaderless.state, SELF, createFeed([createFeedTask('t1')]))).toEqual([]);
  });

  test('the same members in another order, or with their fields written in another order, send nothing', () => {
    const second = { ...MEMBER, taskId: 't2', handle: 'KAI-t2', title: 'Task t2' };
    const reordered = Object.fromEntries(Object.entries(MEMBER).reverse()) as typeof MEMBER;
    const recorded = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative({ teamMembers: [second, reordered] }) };
    });
    const feed = createFeed([createFeedTask('t1'), createFeedTask('t2')]);
    expect(listTeamMembersUpdates(recorded.state, SELF, feed)).toEqual([]);
    const forth = { initiativeId: 'chat', teamId: 'team-1', previous: [], members: [MEMBER, second] };
    expect(resolveTeamMembersId(forth)).toBe(
      resolveTeamMembersId({ ...forth, members: [second, reordered] })
    );
  });

  test('names a change by both sides, so going back to an earlier list is a new command', () => {
    const forth = { initiativeId: 'chat', teamId: 'team-1', previous: [], members: [MEMBER] };
    const back = { initiativeId: 'chat', teamId: 'team-1', previous: [MEMBER], members: [] };
    const again = { ...forth };
    expect(resolveTeamMembersId(forth)).toBe(resolveTeamMembersId(again));
    expect(resolveTeamMembersId(forth)).not.toBe(resolveTeamMembersId(back));
    expect(resolveTeamMembersId(forth)).toStartWith('team-members:chat:team-1:');
  });
});

function runMembers(
  stub: StubEngine,
  feed: TeamFeedSnapshot,
  instanceId: string | null,
  use: (
    members: TeamMembers['Service'],
    publish: Effect.Effect<void>
  ) => Effect.Effect<void, never, Scope.Scope>
) {
  const listeners = new Set<Effect.Effect<void>>();
  const feeds = Layer.succeed(TeamFeeds, {
    snapshot: Effect.succeed(feed),
    observe: (listener: Effect.Effect<void>) =>
      Effect.acquireRelease(
        Effect.sync(() => listeners.add(listener)),
        () => Effect.sync(() => listeners.delete(listener))
      ).pipe(Effect.asVoid),
  } as unknown as TeamFeeds['Service']);
  const store = Layer.succeed(RemoteStore, {
    file: Effect.succeed({ credentials: instanceId ? { instanceId } : null }),
  } as unknown as RemoteStore['Service']);
  const publish = Effect.suspend(() =>
    Effect.forEach([...listeners], (listener) => listener, { discard: true })
  );
  return Effect.runPromise(
    TeamMembers.use((members) => use(members, publish)).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          TeamMembers.layer.pipe(
            Layer.provide(Layer.mergeAll(createStubEngineCoreLayer(stub), feeds, store))
          ),
          JsonLogger
        )
      )
    )
  );
}

describe('the team members watch', () => {
  test('records the members on start and again on each feed change, under an id from the change', async () => {
    const stub = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative() };
    });
    const feed = createFeed([createFeedTask('t1')]);
    await runMembers(stub, feed, SELF, (members, publish) =>
      Effect.gen(function* () {
        yield* members.start;
        stub.state.initiatives.chat = createInitiative({ teamMembers: [MEMBER] });
        feed.tasks = [];
        yield* publish;
      })
    );
    expect(stub.dispatched).toEqual([
      { type: 'initiative.record_team_members', initiativeId: 'chat', teamId: 'team-1', members: [MEMBER] },
      { type: 'initiative.record_team_members', initiativeId: 'chat', teamId: 'team-1', members: [] },
    ]);
    expect(stub.commandIds[0]).toStartWith('team-members:chat:team-1:');
    expect(stub.commandIds[0]).not.toBe(stub.commandIds[1]);
  });

  test('records nothing before the machine is paired', async () => {
    const stub = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative() };
    });
    await runMembers(stub, createFeed([createFeedTask('t1')]), null, (members) => members.sync);
    expect(stub.dispatched).toEqual([]);
  });

  test('logs a refused record and carries on', async () => {
    const stub = createStubEngine((state) => {
      state.initiatives = { chat: createInitiative() };
    });
    stub.reject(() => true);
    const logs = captureLogs();
    await runMembers(stub, createFeed([createFeedTask('t1')]), SELF, (members) => members.sync);
    expect(logs.fieldsOf('[Leads] Could not record a teammate’s tasks in an initiative')).toMatchObject([
      { initiativeId: 'chat' },
    ]);
    logs.restore();
  });
});
