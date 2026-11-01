import { describe, expect, test } from 'bun:test';
import type { Project, RemoteTeam, TeamFeedMachine, TeamFeedTask } from '@shinsa/core';
import { resolveTeammateCheck, TEAMMATE_TEXT_LIMIT } from '../../src/triage/team.ts';
import { createTask } from '../helpers/state.ts';

const MONA = { id: '1', login: 'mona', name: null, avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: 'Kai Tanaka', avatarUrl: 'https://avatars.example/kai.png' };

const MONA_PROFILE = { login: 'mona', name: null, avatarUrl: null };

const KAI_PROFILE = { login: 'kai', name: 'Kai Tanaka', avatarUrl: 'https://avatars.example/kai.png' };

const PROJECT = {
  id: 'p1',
  name: 'Basket',
  color: 'blue',
  key: 'BAS',
  description: '',
  folders: [],
  teamIds: ['team1'],
} as Project;

function createTeam(id: string): RemoteTeam {
  return {
    id,
    name: 'Platform',
    owner: MONA,
    role: 'member',
    members: [{ user: KAI, addedAt: 2 }],
    requests: [],
    machines: [],
    createdAt: 1,
  };
}

function machine(overrides: Partial<TeamFeedMachine> = {}): TeamFeedMachine {
  return {
    teamId: 'team1',
    instanceId: 'studio',
    name: 'Studio',
    userId: MONA.id,
    status: 'live',
    reason: null,
    ...overrides,
  };
}

function listing(
  overrides: Partial<TeamFeedTask> = {},
  task: Parameters<typeof createTask>[0] = {}
): TeamFeedTask {
  return {
    task: createTask({
      id: 'kt1',
      handle: 'MON-12',
      title: 'Add dark mode',
      request: 'Add a dark theme',
      ...task,
    }),
    gates: [],
    project: null,
    repo: null,
    owner: 'mona',
    machine: 'Studio',
    teamId: 'team1',
    instanceId: 'studio',
    ...overrides,
  };
}

const TEAMS = [createTeam('team1'), createTeam('team2')];

describe('resolveTeammateCheck', () => {
  test('a task whose project is in no team gets no team check', () => {
    const feed = { machines: [machine()], tasks: [listing()] };
    expect(resolveTeammateCheck(null, { feed, teams: TEAMS, self: null })).toBeNull();
    expect(resolveTeammateCheck({ ...PROJECT, teamIds: [] }, { feed, teams: TEAMS, self: null })).toBeNull();
  });

  test('lists the open tasks of the project’s teams only, each keyed apart from local tasks', () => {
    const feed = {
      machines: [machine()],
      tasks: [
        listing(),
        listing({}, { id: 'kt2', stage: 'merged', title: 'Old work' }),
        listing({ teamId: 'team2' }, { id: 'kt3', title: 'Another team' }),
        listing({}, { id: 'kt4', handle: null, title: 'Second', request: 'Make it faster' }),
      ],
    };
    const check = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS, self: null });
    expect(check?.tasks).toEqual([
      {
        key: 'teammate-1',
        original: {
          teamId: 'team1',
          machineId: 'studio',
          taskId: 'kt1',
          handle: 'MON-12',
          title: 'Add dark mode',
          owner: MONA_PROFILE,
        },
        stage: 'building',
        request: 'Add a dark theme',
        goal: null,
      },
      expect.objectContaining({
        key: 'teammate-2',
        original: expect.objectContaining({ taskId: 'kt4', handle: null }),
      }),
    ]);
    expect(check?.unreached).toEqual([]);
  });

  test('a machine in two of the project’s teams lists each task once', () => {
    const feed = {
      machines: [machine(), machine({ teamId: 'team2' })],
      tasks: [listing(), listing({ teamId: 'team2' })],
    };
    const check = resolveTeammateCheck(
      { ...PROJECT, teamIds: ['team1', 'team2'] },
      { feed, teams: TEAMS, self: null }
    );
    expect(check?.tasks.map((task) => task.original.taskId)).toEqual(['kt1']);
  });

  test('the request and the plan goal are flattened and clipped; the owner falls back to the team’s member', () => {
    const long = 'word '.repeat(200);
    const feed = {
      machines: [machine({ instanceId: 'laptop', userId: KAI.id })],
      tasks: [
        listing(
          { owner: null, instanceId: 'laptop' },
          {
            request: `Line one\n\n${long}`,
            plan: { version: 1, document: { goal: 'Ship  the\ntheme' } } as never,
          }
        ),
      ],
    };
    const [task] = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS, self: null })?.tasks ?? [];
    expect(task?.original.owner).toEqual(KAI_PROFILE);
    expect(task?.goal).toBe('Ship the theme');
    expect(task?.request.startsWith('Line one word word')).toBe(true);
    expect(task?.request.endsWith('…')).toBe(true);
    expect(task?.request.length).toBeLessThanOrEqual(TEAMMATE_TEXT_LIMIT + 1);
  });

  test('a listing’s own owner profile names them, ahead of what the team knows', () => {
    const feed = {
      machines: [machine({ userId: KAI.id })],
      tasks: [listing({ owner: 'kai', ownerProfile: { name: 'Kai T', avatarUrl: null } })],
    };
    const [task] = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS, self: null })?.tasks ?? [];
    expect(task?.original.owner).toEqual({ login: 'kai', name: 'Kai T', avatarUrl: KAI.avatarUrl });
  });

  test('a machine whose kept copy is compared is not unreached, though it is offline', () => {
    const feed = {
      machines: [machine({ status: 'offline', updatedAt: 5 })],
      tasks: [listing()],
    };
    const check = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS, self: null });
    expect(check?.tasks).toHaveLength(1);
    expect(check?.unreached).toEqual([]);
  });

  test('an owner the team does not know by that login is named by the login alone', () => {
    const feed = { machines: [machine({ userId: KAI.id })], tasks: [listing({ owner: 'lee' })] };
    const [task] = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS, self: null })?.tasks ?? [];
    expect(task?.original.owner).toEqual({ login: 'lee', name: null, avatarUrl: null });
  });

  test('every machine not live is unreached once, with its owner when the team knows them', () => {
    const feed = {
      machines: [
        machine(),
        machine({ instanceId: 'laptop', name: 'Laptop', userId: KAI.id, status: 'offline' }),
        machine({ instanceId: 'laptop', name: 'Laptop', userId: KAI.id, status: 'offline', teamId: 'team2' }),
        machine({ instanceId: 'box', name: 'Box', userId: '99', status: 'refused' }),
        machine({ instanceId: 'new', name: 'New', userId: MONA.id, status: 'connecting' }),
        machine({ instanceId: 'gone', name: 'Gone', teamId: 'team3', status: 'offline' }),
        machine({ instanceId: 'lost', name: 'Lost', teamId: 'team4', status: 'offline' }),
      ],
      tasks: [],
    };
    const project = { ...PROJECT, teamIds: ['team1', 'team2', 'team4'] };
    expect(resolveTeammateCheck(project, { feed, teams: TEAMS, self: null })?.unreached).toEqual([
      { teamId: 'team1', machineId: 'laptop', name: 'Laptop', owner: KAI_PROFILE },
      { teamId: 'team1', machineId: 'box', name: 'Box', owner: null },
      { teamId: 'team1', machineId: 'new', name: 'New', owner: MONA_PROFILE },
      { teamId: 'team4', machineId: 'lost', name: 'Lost', owner: null },
    ]);
  });

  test('with no feed at all, every other machine of the project’s teams is unreached', () => {
    const team: RemoteTeam = {
      ...createTeam('core'),
      machines: [
        { id: 'own', name: 'Desk', userId: MONA.id, online: true, lastSeenAt: 1 },
        { id: 'laptop', name: 'Laptop', userId: KAI.id, online: true, lastSeenAt: 1 },
      ],
    };
    const check = resolveTeammateCheck(
      { ...PROJECT, teamIds: ['core'] },
      { feed: { machines: [], tasks: [] }, teams: [team], self: 'own' }
    );
    expect(check).toEqual({
      tasks: [],
      unreached: [{ teamId: 'core', machineId: 'laptop', name: 'Laptop', owner: KAI_PROFILE }],
    });
  });

  test('a live feed of a team machine counts it as reached', () => {
    const team: RemoteTeam = {
      ...createTeam('team1'),
      machines: [{ id: 'studio', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: 1 }],
    };
    const feed = { machines: [machine()], tasks: [] };
    expect(resolveTeammateCheck(PROJECT, { feed, teams: [team], self: null })?.unreached).toEqual([]);
  });
});
