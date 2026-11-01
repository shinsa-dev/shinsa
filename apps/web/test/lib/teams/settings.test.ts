import { describe, expect, it } from 'bun:test';
import {
  canUseTeams,
  createTeamDraft,
  describePeopleCount,
  describeTeamEntry,
  describeTeamsUnavailable,
  hasMachineAccess,
  listProjectChoices,
  listTeamPeople,
  listTeamProjectCommands,
  needsTeamLink,
  resolveProjectPick,
  TEAM_PROJECTS_REQUIRED,
  validateTeamDraft,
  validateTeamLink,
  validateTeamLinkProjects,
} from '@/lib/teams/settings.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { BOB, createTeam, createTeamEntry, KAI, MONA, TEAM_URL } from '../../support/teams.ts';

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

  it('says who owns a team, how many are in it, and when a request waits', () => {
    const team = createTeam({ createdAt: NOW - 2 * 86_400_000 });
    expect(describeTeamEntry(createTeamEntry({ team }), NOW)).toBe('You own it · 2 people · Made 2d ago');
    const alone = createTeam({ owner: KAI, role: 'member', members: [], createdAt: NOW - 2 * 86_400_000 });
    expect(describeTeamEntry(createTeamEntry({ team: alone }), NOW)).toBe(
      'Owned by Kai · 1 person · Made 2d ago'
    );
    expect(describeTeamEntry(createTeamEntry({ team: null }), NOW)).toBe(
      'You asked to join. The team’s owner has not answered yet.'
    );
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

  it('checks a new team’s name, and that a pasted link is this team’s', () => {
    const draft = createTeamDraft();
    expect(draft).toEqual({ name: '', projectIds: [] });
    expect(validateTeamDraft(draft)).toBe('Give the team a name.');
    expect(validateTeamDraft({ ...draft, name: 'x'.repeat(61) })).toBe('Keep the name to 60 characters.');
    expect(validateTeamDraft({ ...draft, name: 'Platform' })).toBeNull();
    expect(validateTeamLink('team1', 'https://example.com')).toContain('not a team link');
    expect(validateTeamLink('team2', TEAM_URL)).toBe('That link is for another team.');
    expect(validateTeamLink('team1', ` ${TEAM_URL} `)).toBeNull();
  });

  it('asks for a project to share when a machine has any', () => {
    const projects = [{ id: 'web', name: 'Web', color: 'blue' }];
    expect(validateTeamLinkProjects([], [])).toBeNull();
    expect(validateTeamLinkProjects(projects, [])).toBe(TEAM_PROJECTS_REQUIRED);
    expect(validateTeamLinkProjects(projects, ['gone'])).toBe(TEAM_PROJECTS_REQUIRED);
    expect(validateTeamLinkProjects(projects, ['web'])).toBeNull();
  });

  it('says who in a team can reach this machine', () => {
    const snapshot = createRemoteSnapshot({ access: { owner: MONA, members: [{ user: KAI, addedAt: 3 }] } });
    expect(hasMachineAccess(snapshot, KAI.id)).toBe(true);
    expect(hasMachineAccess(snapshot, BOB.id)).toBe(false);
    expect(hasMachineAccess(createRemoteSnapshot(), KAI.id)).toBe(false);
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
});
