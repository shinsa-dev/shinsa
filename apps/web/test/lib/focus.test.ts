import { describe, expect, it } from 'bun:test';
import {
  resolveFocusLabel,
  describeStatsScope,
  listFocusTeams,
  resolveFocusTarget,
  resolveKeptUntil,
  selectFocusProjects,
  toggleFocusProject,
  resolveFocusUntil,
  selectFocus,
  selectFocusTeam,
  UNNAMED_TEAM,
} from '@/lib/focus.ts';
import { createRemoteSnapshot } from '../support/remote-access.ts';
import { createProject, createShinsaState, NOW } from '../support/state.ts';
import { createTeamEntry } from '../support/teams.ts';

describe('selectFocus', () => {
  const projects = [createProject({ id: 'work', name: 'Work' })];

  it('returns the focused project while the focus lasts', () => {
    const state = createShinsaState({
      projects,
      patch: { focus: { projectIds: ['work'], except: false, teamId: null, until: NOW + 1000 } },
    });
    expect(selectFocus(state, NOW)?.name).toBe('Work');
    expect(selectFocus(state, NOW + 1000)).toBeNull();
  });

  it('returns null without a focus or when the project is gone', () => {
    expect(selectFocus(createShinsaState({ projects }), NOW)).toBeNull();
    expect(
      selectFocus(
        createShinsaState({
          patch: { focus: { projectIds: ['gone'], except: false, teamId: null, until: null } },
        })
      )
    ).toBeNull();
  });
});

describe('a focus on several projects', () => {
  const projects = ['Work', 'Home', 'Shop'].map((name) => createProject({ id: name.toLowerCase(), name }));

  function focusOn(projectIds: string[], except = false, until: number | null = null) {
    return createShinsaState({ projects, patch: { focus: { projectIds, except, teamId: null, until } } });
  }

  it('leaves out a project that is gone, and nothing once the focus is over', () => {
    expect(selectFocusProjects(focusOn(['gone', 'work'], true), NOW)).toEqual({
      projectIds: ['work'],
      except: true,
    });
    expect(selectFocusProjects(focusOn(['gone'], true), NOW)).toEqual({ projectIds: [], except: false });
    expect(selectFocusProjects(focusOn(['work'], false, NOW), NOW)).toEqual({
      projectIds: [],
      except: false,
    });
  });

  it.each([
    [[], false, null],
    [['work'], false, 'Work'],
    [['work', 'home'], false, 'Home and Work'],
    [['work', 'home', 'shop'], false, '3 projects'],
    [['work'], true, 'All but Work'],
    [['work', 'shop'], true, 'All but Shop and Work'],
    [['work', 'home', 'shop'], true, 'All but 3 projects'],
  ])('names %j with except %s as %s', (projectIds, except, label) => {
    expect(resolveFocusLabel(focusOn([]), { projectIds, except })).toBe(label);
  });

  it('ticks a project in or out, and drops the exclusion with the last one', () => {
    expect(toggleFocusProject({ projectIds: ['work'], except: false }, 'home')).toEqual({
      projectIds: ['home', 'work'],
      except: false,
    });
    expect(toggleFocusProject({ projectIds: ['work'], except: true }, 'work')).toEqual({
      projectIds: [],
      except: false,
    });
  });

  it('sends one included project as projectId, so an older engine reads it, and anything else as the set', () => {
    expect(resolveFocusTarget({ projectIds: [], except: false })).toEqual({ projectId: null, teamId: null });
    expect(resolveFocusTarget({ projectIds: ['work'], except: false })).toEqual({
      projectId: 'work',
      teamId: null,
    });
    expect(resolveFocusTarget({ projectIds: ['work'], except: true })).toEqual({
      projectId: null,
      projectIds: ['work'],
      except: true,
      teamId: null,
    });
    expect(resolveFocusTarget({ projectIds: ['work'], except: false }, 'team1')).toEqual({
      projectId: null,
      teamId: 'team1',
    });
  });

  it('keeps a focus timer only while it runs', () => {
    expect(resolveKeptUntil(focusOn(['work'], false, NOW + 10), NOW)).toBe(NOW + 10);
    expect(resolveKeptUntil(focusOn(['work'], false, NOW), NOW)).toBeNull();
    expect(resolveKeptUntil(focusOn(['work']))).toBeNull();
  });

  it('says which projects the statistics count', () => {
    expect(describeStatsScope('Work', { projectIds: ['work'], except: false })).toBe(
      'Only Work, the project in focus'
    );
    expect(describeStatsScope('All but Work', { projectIds: ['work'], except: true })).toBe(
      'Only what is in focus: All but Work'
    );
  });
});

describe('team focus', () => {
  it('lists the teams you are in by name, never one you only asked to join', () => {
    const remote = createRemoteSnapshot({
      teams: [
        createTeamEntry({ id: 'b', name: 'Platform' }),
        createTeamEntry({ id: 'a', name: 'Apps' }),
        createTeamEntry({ id: 'c', name: 'Asked', team: null, status: 'requested' }),
      ],
    });
    expect(listFocusTeams(remote)).toEqual([
      { id: 'a', name: 'Apps' },
      { id: 'b', name: 'Platform' },
    ]);
    expect(listFocusTeams(null)).toEqual([]);
  });

  it('names the team in focus while the focus lasts, even before its name is known', () => {
    const teams = [{ id: 'team1', name: 'Platform' }];
    const focused = createShinsaState({
      patch: { focus: { projectIds: [], except: false, teamId: 'team1', until: NOW + 10 } },
    });
    expect(selectFocusTeam(focused, teams, NOW)).toEqual({ id: 'team1', name: 'Platform' });
    expect(selectFocusTeam(focused, [], NOW)).toEqual({ id: 'team1', name: UNNAMED_TEAM });
    expect(selectFocusTeam(focused, teams, NOW + 10)).toBeNull();
    expect(selectFocusTeam(createShinsaState({}), teams)).toBeNull();
  });
});

describe('resolveFocusUntil', () => {
  it('keeps the focus for two hours or until the end of the day', () => {
    expect(resolveFocusUntil('hours', NOW)).toBe(NOW + 2 * 60 * 60_000);
    const tonight = new Date(resolveFocusUntil('tonight', new Date(2026, 9, 22, 9).getTime()));
    expect([tonight.getHours(), tonight.getMinutes()]).toEqual([23, 59]);
    expect(resolveFocusUntil('hours')).toBeGreaterThan(Date.now());
  });
});
