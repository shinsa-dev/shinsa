import { describe, expect, it } from 'bun:test';
import { TEAM_REFUSALS } from '@shinsa/core';
import {
  canUseTeams,
  createTeamDraft,
  describeHostedTeam,
  describeHostedTeamsNotice,
  describePeopleCount,
  describeTeamEntry,
  describeTeamFacts,
  describeTeamsUnavailable,
  hasMachineAccess,
  listGrantMachines,
  listProjectChoices,
  scopeStateToProjects,
  listTeamMachineRows,
  listTeamPeople,
  listTeamProjectCommands,
  NO_HOSTED_TEAM,
  needsTeamLink,
  resolveProjectPick,
  listKeylessMachines,
  selectTeamPerson,
  TEAM_MACHINE_NEEDS_KEY,
  validateTeamDraft,
} from '@/lib/teams/settings.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { BOB, createTeam, createTeamEntry, KAI, MONA } from '../../support/teams.ts';

const NOW = Date.now();

const STATE = createShinsaState({
  projects: [
    createProject({ id: 'web', name: 'Web', teamIds: ['team1'] }),
    createProject({ id: 'api', name: 'Api', teamIds: ['team1', 'team2'] }),
    createProject({ id: 'docs', name: 'Docs' }),
  ],
});

describe('Settings → Teams', () => {
  it('works only on a machine with remote access that was not removed, and says why not', () => {
    expect(canUseTeams(createRemoteSnapshot())).toBe(true);
    expect(canUseTeams(createRemoteSnapshot({ status: 'revoked' }))).toBe(false);
    expect(canUseTeams(createRemoteSnapshot({ paired: false }))).toBe(false);
    expect(canUseTeams(null)).toBe(false);
    expect(describeTeamsUnavailable(createRemoteSnapshot({ paired: false }))).toBe(
      'Teams reach your teammates through remote access. Turn it on above first.'
    );
    expect(describeTeamsUnavailable(createRemoteSnapshot({ status: 'revoked' }))).toContain('was removed');
  });

  it('says who owns a team, how many are in it, how many are online, and when a request waits', () => {
    const team = createTeam({
      machines: [
        { id: 'm1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: NOW },
        { id: 'm2', name: 'Spare', userId: MONA.id, online: true, lastSeenAt: NOW },
        { id: 'm3', name: 'Laptop', userId: KAI.id, online: true, lastSeenAt: NOW },
      ],
    });
    expect(describeTeamEntry(createTeamEntry({ team }))).toEqual(['You own it · 2 people · 2 online']);
    const dropped = {
      tasks: [],
      machines: [
        {
          teamId: team.id,
          instanceId: 'm3',
          name: 'Laptop',
          userId: KAI.id,
          status: 'offline' as const,
          reason: null,
        },
      ],
    };
    expect(describeTeamFacts(team, dropped)).toBe('2 people · 1 online');
    const alone = createTeam({ owner: KAI, role: 'member', members: [] });
    expect(describeTeamEntry(createTeamEntry({ team: alone }))).toEqual([
      'Owned by ',
      { user: KAI },
      ' · 1 person · 0 online',
    ]);
    expect(describeTeamEntry(createTeamEntry({ team: null }))).toEqual([
      'You asked to join. The team’s owner has not answered yet.',
    ]);
  });

  it('asks for the team link only on a machine in the team without its key', () => {
    expect(needsTeamLink(createTeamEntry({ onMachine: false }))).toBe(true);
    expect(needsTeamLink(createTeamEntry())).toBe(false);
    expect(needsTeamLink(createTeamEntry({ team: null, onMachine: false }))).toBe(false);
  });

  it('lists the projects to choose by name, and names the ones picked in the dropdown', () => {
    const projects = listProjectChoices(STATE);
    expect(projects.map((project) => project.name)).toEqual(['Api', 'Docs', 'Web']);
    expect(resolveProjectPick(projects, [])).toEqual({ dots: [], label: 'No projects' });
    expect(resolveProjectPick(projects, ['web']).label).toBe('Web');
    expect(resolveProjectPick(projects, ['web', 'api']).label).toBe('Api, Web');
    const three = resolveProjectPick(projects, ['web', 'api', 'docs']);
    expect(three.label).toBe('Api and 2 more');
    expect(three.dots.map((project) => project.id)).toEqual(['api', 'docs', 'web']);
  });

  it('turns the projects you chose into the commands that add and remove them', () => {
    expect(listTeamProjectCommands(STATE, 'team1', ['web', 'docs', 'gone'])).toEqual([
      { type: 'project.add_to_team', projectId: 'docs', teamId: 'team1' },
      { type: 'project.remove_from_team', projectId: 'api', teamId: 'team1' },
    ]);
    expect(listTeamProjectCommands(STATE, 'team1', ['web', 'api'])).toEqual([]);
  });

  it('checks a new team’s name', () => {
    const draft = createTeamDraft();
    expect(draft).toEqual({ name: '', projectIds: [] });
    expect(validateTeamDraft(draft)).toBe('Give the team a name.');
    expect(validateTeamDraft({ ...draft, name: 'x'.repeat(61) })).toBe('Keep the name to 60 characters.');
    expect(validateTeamDraft({ ...draft, name: 'Platform' })).toBeNull();
  });

  it('flags this machine as keyless only when it is in the team without the key', () => {
    const snapshot = createRemoteSnapshot({ instanceId: 'm1' });
    expect([...listKeylessMachines(createTeamEntry({ onMachine: false }), snapshot)]).toEqual(['m1']);
    expect([...listKeylessMachines(createTeamEntry(), snapshot)]).toEqual([]);
    expect([...listKeylessMachines(createTeamEntry({ onMachine: false }), { instanceId: null })]).toEqual([]);
  });

  it('finds a person of a team by id, owner or member', () => {
    const team = createTeam({ owner: MONA, members: [{ user: KAI, addedAt: 1 }] });
    expect(selectTeamPerson(team, MONA.id)).toBe(MONA);
    expect(selectTeamPerson(team, KAI.id)).toBe(KAI);
    expect(selectTeamPerson(team, 'gone')).toBeNull();
  });

  it('says who in a team can reach this machine', () => {
    const snapshot = createRemoteSnapshot({ access: { owner: MONA, members: [{ user: KAI, addedAt: 3 }] } });
    expect(hasMachineAccess(snapshot, KAI.id)).toBe(true);
    expect(hasMachineAccess(snapshot, BOB.id)).toBe(false);
    expect(hasMachineAccess(createRemoteSnapshot(), KAI.id)).toBe(false);
  });

  it('offers the machine you asked from first, then every other one of yours they cannot reach yet', () => {
    const open = createRemoteSnapshot({ enabled: true });
    const reached = createRemoteSnapshot({
      enabled: true,
      access: { owner: MONA, members: [{ user: KAI, addedAt: 3 }] },
    });
    const machines = [
      { id: 'studio', name: 'Studio', remote: open },
      { id: 'laptop', name: 'Laptop', remote: open },
      { id: 'mini', name: 'Mini', remote: reached },
      { id: 'off', name: 'Off', remote: createRemoteSnapshot({ enabled: false }) },
      { id: 'none', name: 'None', remote: null },
    ];
    expect(listGrantMachines(machines, { id: 'studio', name: 'Studio' }, KAI.id)).toEqual([
      { id: 'studio', name: 'Studio' },
      { id: 'laptop', name: 'Laptop' },
    ]);
    expect(listGrantMachines([], { id: null, name: 'this machine' }, KAI.id)).toEqual([
      { id: null, name: 'this machine' },
    ]);
  });

  it('lists the owner first, then the members, and finds people by name or login', () => {
    const team = createTeam({
      members: [
        { user: KAI, addedAt: 1 },
        { user: BOB, addedAt: 2 },
      ],
    });
    expect(listTeamPeople(team, '').map((person) => person.user.login)).toEqual(['mona', 'kai', 'bob']);
    expect(listTeamPeople(team, '').map((person) => person.member === null)).toEqual([true, false, false]);
    expect(listTeamPeople(team, ' LANE ').map((person) => person.user.login)).toEqual(['kai']);
    expect(listTeamPeople(team, 'bo').map((person) => person.user.login)).toEqual(['bob']);
    expect(listTeamPeople(team, 'nobody')).toEqual([]);
    expect(describePeopleCount(team)).toBe('3');
  });

  it('describes a hosted team with your role, its people and its machines', () => {
    const machine = { id: 'm1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: NOW };
    const team = createTeam({ machines: [machine] });
    expect(describeHostedTeam(team)).toEqual(['You own it · 2 people · 1 online · 1 machine']);
    const joined = createTeam({ owner: KAI, role: 'member', members: [], machines: [] });
    expect(describeHostedTeam(joined)).toEqual([
      'Owned by ',
      { user: KAI },
      ' · 1 person · 0 online · 0 machines',
    ]);
  });

  it('lists a team’s machines with their status and owner', () => {
    const team = createTeam({
      machines: [
        { id: 'm1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: NOW },
        { id: 'm2', name: 'Laptop', userId: KAI.id, online: false, lastSeenAt: NOW - 2 * 3_600_000 },
        { id: 'm3', name: 'Spare', userId: 'gone', online: false, lastSeenAt: null },
      ],
    });
    expect(
      listTeamMachineRows(team, NOW).map(({ machine, tone, status, owner }) => [
        machine.name,
        tone,
        status,
        owner?.login ?? null,
      ])
    ).toEqual([
      ['Studio', 'online', 'Online', 'mona'],
      ['Laptop', 'quiet', 'Last seen 2h ago', 'kai'],
      ['Spare', 'quiet', 'Never connected', null],
    ]);
  });

  it('says a machine waits for the team’s key when it holds none, here or as its feed reports', () => {
    const team = createTeam({
      machines: [
        { id: 'm1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: NOW },
        { id: 'm2', name: 'Mac.lan', userId: KAI.id, online: true, lastSeenAt: NOW },
        { id: 'm3', name: 'Spare', userId: KAI.id, online: true, lastSeenAt: NOW },
      ],
    });
    const refused = { teamId: team.id, name: '', userId: KAI.id, status: 'refused' as const };
    const feed = {
      tasks: [],
      machines: [
        { ...refused, instanceId: 'm2', reason: TEAM_REFUSALS.key },
        { ...refused, instanceId: 'm3', reason: TEAM_REFUSALS.member },
      ],
    };
    expect(
      listTeamMachineRows(team, NOW, feed, new Set(['m1'])).map(({ tone, status }) => [tone, status])
    ).toEqual([
      ['warning', TEAM_MACHINE_NEEDS_KEY],
      ['warning', TEAM_MACHINE_NEEDS_KEY],
      ['quiet', 'Last seen just now'],
    ]);
  });

  it('turns a machine offline the moment its live channel drops, and online as soon as it answers', () => {
    const team = createTeam({
      machines: [
        { id: 'm1', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: NOW - 3_600_000 },
        { id: 'm2', name: 'Laptop', userId: KAI.id, online: false, lastSeenAt: null },
        { id: 'm3', name: 'Spare', userId: KAI.id, online: true, lastSeenAt: NOW },
      ],
    });
    const machine = { teamId: team.id, name: '', reason: null } as const;
    const feed = {
      tasks: [],
      machines: [
        {
          ...machine,
          instanceId: 'm1',
          userId: MONA.id,
          status: 'offline' as const,
          updatedAt: NOW - 60_000,
        },
        { ...machine, instanceId: 'm2', userId: KAI.id, status: 'live' as const },
        { ...machine, instanceId: 'm3', userId: KAI.id, status: 'connecting' as const },
      ],
    };
    expect(listTeamMachineRows(team, NOW, feed).map(({ tone, status }) => [tone, status])).toEqual([
      ['quiet', 'Last seen 1m ago'],
      ['online', 'Online'],
      ['online', 'Online'],
    ]);
  });

  it('says why the hosted Teams section has no team to show', () => {
    expect(describeHostedTeamsNotice(null, 'Signed out')).toBe('Signed out');
    expect(describeHostedTeamsNotice(null, null)).toBe('Reading your teams…');
    expect(describeHostedTeamsNotice({ viewerId: null, teams: [] }, null)).toBe(NO_HOSTED_TEAM);
  });
});

describe('scopeStateToProjects', () => {
  it('keeps only the projects of one machine, so its teams offer only those', () => {
    const state = createShinsaState({
      projects: [createProject({ id: 'web' }), createProject({ id: 'api' })],
    });
    const scoped = scopeStateToProjects(state, ['api', 'gone']);
    expect(Object.keys(scoped.projects)).toEqual(['api']);
    expect(scoped.tasks).toBe(state.tasks);
  });
});
