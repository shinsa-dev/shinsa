import { describe, expect, it } from 'bun:test';
import { NO_TEAM_FEED, type TeamFeedMachine } from '@shinsa/core';
import type { TeamChannelHandlers, TeamChannelTarget } from '@/lib/teams/channel.ts';
import {
  describeTeamTaskOwner,
  HostedTeamFeeds,
  listOpenTeamFeedTasks,
  listTeamFeedTasks,
  matchesTeamTaskSearch,
  mergeTeamFeeds,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  resolveTeamTaskTarget,
} from '@/lib/teams/feeds.ts';
import { createGate, createProject, createTask } from '../../support/state.ts';
import { createTeam } from '../../support/teams.ts';
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

  it('lists one team’s tasks, open ones first and the newest first, leaving out machines you reach with full control', () => {
    const done = createTeamFeedTask({ task: createTask({ id: 'done', stage: 'merged', updatedAt: 50 }) });
    const recent = createTeamFeedTask({ task: createTask({ id: 'recent', updatedAt: 40 }) });
    const old = createTeamFeedTask({ task: createTask({ id: 'old', updatedAt: 5 }) });
    const otherTeam = createTeamFeedTask({ teamId: 'team2', task: createTask({ id: 'other' }) });
    const reachable = createTeamFeedTask({ instanceId: 'k3x9', task: createTask({ id: 'mine' }) });
    const feed = { machines: [], tasks: [old, done, otherTeam, reachable, recent] };
    const listed = listTeamFeedTasks(feed, 'team1', new Set(['k3x9']));
    expect(listed.map((entry) => entry.task.id)).toEqual(['recent', 'old', 'done']);
    expect(listOpenTeamFeedTasks(listed).map((entry) => entry.task.id)).toEqual(['recent', 'old']);
  });

  it('opens a teammate’s task at its own address and names whose it is', () => {
    const entry = createTeamFeedTask();
    expect(resolveTeamTaskTarget(entry)).toEqual({ teamId: 'team1', instanceId: 'p7m2', taskId: 'kai-task' });
    expect(resolveTeamTaskPath({ teamId: 'a b', instanceId: 'm', taskId: 't' })).toBe('/teams/a%20b/m/t');
    expect(describeTeamTaskOwner(entry)).toBe('@kai');
    expect(describeTeamTaskOwner({ owner: null, machine: 'Studio' })).toBe('Studio');
    expect(describeTeamTaskOwner({ owner: null, machine: null })).toBe('A teammate');
  });

  it('builds a state of just the task, its gates and its project, so its status reads as on its own machine', () => {
    const gate = createGate({ id: 'g1', taskId: 'kai-task' });
    const project = createProject({ id: 'p1', name: 'Platform' });
    const state = resolveTeamTaskState(createTeamFeedTask({ gates: [gate], project }));
    expect(Object.keys(state.tasks)).toEqual(['kai-task']);
    expect(state.gates).toEqual({ g1: gate });
    expect(state.projects).toEqual({ p1: project });
    expect(resolveTeamTaskState(createTeamFeedTask()).projects).toEqual({});
  });

  it('matches a search against the title, handle, owner and machine', () => {
    const entry = createTeamFeedTask();
    expect(matchesTeamTaskSearch(entry, '')).toBe(true);
    expect(matchesTeamTaskSearch(entry, 'BILLING')).toBe(true);
    expect(matchesTeamTaskSearch(entry, 'pl-3')).toBe(true);
    expect(matchesTeamTaskSearch(entry, 'kai')).toBe(true);
    expect(matchesTeamTaskSearch(entry, 'studio')).toBe(true);
    expect(
      matchesTeamTaskSearch(createTeamFeedTask({ task: createTask({ id: 'bare', handle: undefined }) }), 'x')
    ).toBe(false);
  });
});

describe('the hosted dashboard’s team feeds', () => {
  function createHosted(options: { keys?: Record<string, string>; failing?: boolean } = {}) {
    const opened: { target: TeamChannelTarget; handlers: TeamChannelHandlers; stopped: boolean }[] = [];
    const waits: (() => void)[] = [];
    const team = createTeam({
      machines: [
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
      wait: (_ms, run) => {
        waits.push(run);
        return () => undefined;
      },
    });
    return { feeds, opened, waits };
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

  it('tries again after a drop and stops trying once the machine refuses', async () => {
    const { feeds, opened, waits } = createHosted();
    await feeds.start();
    opened[0]?.handlers.onEnd({ reason: 'Offline.', gone: false });
    expect(feeds.snapshot().machines[0]).toMatchObject({ status: 'offline', reason: 'Offline.' });
    waits.shift()?.();
    expect(opened).toHaveLength(2);
    opened[1]?.handlers.onEnd({ reason: 'Not in the team.', gone: true });
    expect(feeds.snapshot().machines[0]).toMatchObject({ status: 'refused', reason: 'Not in the team.' });
    expect(waits).toEqual([]);
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

  it('stops before it opens anything when stopped while the teams load', async () => {
    const { feeds, opened } = createHosted();
    const started = feeds.start();
    feeds.stop();
    await started;
    expect(opened).toEqual([]);
  });
});
