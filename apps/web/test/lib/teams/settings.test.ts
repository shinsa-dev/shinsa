import { describe, expect, it } from 'bun:test';
import {
  canUseTeams,
  createTeamDraft,
  describeJoinOutcome,
  describeTeamEntry,
  describeTeamProjects,
  describeTeamsUnavailable,
  listProjectChoices,
  listTeamProjectCommands,
  needsTeamLink,
  toggleDraftProject,
  validateTeamDraft,
} from '@/lib/teams/settings.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { createTeam, createTeamEntry, KAI, TEAM_URL } from '../../support/teams.ts';

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
      'Owned by Kai Lane · 1 person · Made 2d ago'
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

  it('lists the projects to choose by name and says which a team sees', () => {
    expect(listProjectChoices(STATE).map((project) => project.name)).toEqual(['Api', 'Docs', 'Web']);
    expect(describeTeamProjects(STATE, 'team1')).toBe('You share Api, Web.');
    expect(describeTeamProjects(STATE, 'team3')).toBe('You share no project with it.');
  });

  it('turns the projects you chose into the commands that add and remove them', () => {
    expect(listTeamProjectCommands(STATE, 'team1', ['web', 'docs', 'gone'])).toEqual([
      { type: 'project.add_to_team', projectId: 'docs', teamId: 'team1' },
      { type: 'project.remove_from_team', projectId: 'api', teamId: 'team1' },
    ]);
    expect(listTeamProjectCommands(STATE, 'team1', ['web', 'api'])).toEqual([]);
  });

  it('checks a new team’s name and a pasted link before sending them', () => {
    const draft = createTeamDraft(['web']);
    expect(draft).toEqual({ name: '', url: '', projectIds: ['web'] });
    expect(validateTeamDraft('create', draft)).toBe('Give the team a name.');
    expect(validateTeamDraft('create', { ...draft, name: 'x'.repeat(61) })).toBe(
      'Keep the name to 60 characters.'
    );
    expect(validateTeamDraft('create', { ...draft, name: 'Platform' })).toBeNull();
    expect(validateTeamDraft('join', { ...draft, url: 'https://example.com' })).toContain('not a team link');
    expect(validateTeamDraft('join', { ...draft, url: TEAM_URL })).toBeNull();
    expect(validateTeamDraft('projects', draft)).toBeNull();
  });

  it('ticks and unticks a project in the draft', () => {
    const draft = createTeamDraft(['web']);
    expect(toggleDraftProject(draft, 'api', true).projectIds).toEqual(['web', 'api']);
    expect(toggleDraftProject(draft, 'web', false).projectIds).toEqual([]);
  });

  it('says what joining did', () => {
    expect(describeJoinOutcome('member')).toBe('You are in the team.');
    expect(describeJoinOutcome('requested')).toBe('Request sent.');
  });
});
