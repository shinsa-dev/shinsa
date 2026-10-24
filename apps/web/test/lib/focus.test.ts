import { describe, expect, it } from 'bun:test';
import { resolveFocusUntil, selectFocus } from '@/lib/focus.ts';
import { createProject, createShinsaState, NOW } from '../support/state.ts';

describe('selectFocus', () => {
  const projects = [createProject({ id: 'work', name: 'Work' })];

  it('returns the focused project while the focus lasts', () => {
    const state = createShinsaState({ projects, patch: { focus: { projectId: 'work', until: NOW + 1000 } } });
    expect(selectFocus(state, NOW)?.name).toBe('Work');
    expect(selectFocus(state, NOW + 1000)).toBeNull();
  });

  it('returns null without a focus or when the project is gone', () => {
    expect(selectFocus(createShinsaState({ projects }), NOW)).toBeNull();
    expect(
      selectFocus(createShinsaState({ patch: { focus: { projectId: 'gone', until: null } } }))
    ).toBeNull();
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
