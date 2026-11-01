import { describe, expect, it } from 'bun:test';
import {
  listFocusTeams,
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
      patch: { focus: { projectId: 'work', teamId: null, until: NOW + 1000 } },
    });
    expect(selectFocus(state, NOW)?.name).toBe('Work');
    expect(selectFocus(state, NOW + 1000)).toBeNull();
  });

  it('returns null without a focus or when the project is gone', () => {
    expect(selectFocus(createShinsaState({ projects }), NOW)).toBeNull();
    expect(
      selectFocus(createShinsaState({ patch: { focus: { projectId: 'gone', teamId: null, until: null } } }))
    ).toBeNull();
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
      patch: { focus: { projectId: null, teamId: 'team1', until: NOW + 10 } },
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
