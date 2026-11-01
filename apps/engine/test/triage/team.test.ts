import { describe, expect, test } from 'bun:test';
import type { Project, RemoteTeam, TeamFeedMachine, TeamFeedTask } from '@shinsa/core';
import { resolveTeammateCheck, TEAMMATE_TEXT_LIMIT } from '../../src/triage/team.ts';
import { createTask } from '../helpers/state.ts';

const MONA = { id: '1', login: 'mona', name: null, avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: null, avatarUrl: null };

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
    expect(resolveTeammateCheck(null, { feed, teams: TEAMS })).toBeNull();
    expect(resolveTeammateCheck({ ...PROJECT, teamIds: [] }, { feed, teams: TEAMS })).toBeNull();
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
    const check = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS });
    expect(check?.tasks).toEqual([
      {
        key: 'teammate-1',
        original: {
          teamId: 'team1',
          machineId: 'studio',
          taskId: 'kt1',
          handle: 'MON-12',
          title: 'Add dark mode',
          owner: 'mona',
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
    const check = resolveTeammateCheck({ ...PROJECT, teamIds: ['team1', 'team2'] }, { feed, teams: TEAMS });
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
    const [task] = resolveTeammateCheck(PROJECT, { feed, teams: TEAMS })?.tasks ?? [];
    expect(task?.original.owner).toBe('kai');
    expect(task?.goal).toBe('Ship the theme');
    expect(task?.request.startsWith('Line one word word')).toBe(true);
    expect(task?.request.endsWith('…')).toBe(true);
    expect(task?.request.length).toBeLessThanOrEqual(TEAMMATE_TEXT_LIMIT + 1);
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
    expect(resolveTeammateCheck(project, { feed, teams: TEAMS })?.unreached).toEqual([
      { teamId: 'team1', machineId: 'laptop', name: 'Laptop', owner: 'kai' },
      { teamId: 'team1', machineId: 'box', name: 'Box', owner: null },
      { teamId: 'team1', machineId: 'new', name: 'New', owner: 'mona' },
      { teamId: 'team4', machineId: 'lost', name: 'Lost', owner: null },
    ]);
  });
});
