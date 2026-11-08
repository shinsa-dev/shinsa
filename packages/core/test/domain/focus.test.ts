import { describe, expect, test } from 'bun:test';
import {
  isProjectInFocus,
  NO_FOCUS_PROJECTS,
  normaliseFocusProjects,
  resolveFocusSelection,
  selectSingleFocusProject,
} from '../../src/index.ts';

describe('the projects in focus', () => {
  test('no projects is everything, a list keeps only those, and all but a list keeps the rest', () => {
    expect(isProjectInFocus(NO_FOCUS_PROJECTS, 'a')).toBe(true);
    expect(isProjectInFocus(NO_FOCUS_PROJECTS, null)).toBe(true);
    const only = { projectIds: ['a', 'b'], except: false };
    expect([isProjectInFocus(only, 'a'), isProjectInFocus(only, 'c'), isProjectInFocus(only, null)]).toEqual([
      true,
      false,
      false,
    ]);
    const allBut = { projectIds: ['a'], except: true };
    expect([
      isProjectInFocus(allBut, 'a'),
      isProjectInFocus(allBut, 'c'),
      isProjectInFocus(allBut, null),
    ]).toEqual([false, true, true]);
  });

  test('names one project only when the focus includes exactly one', () => {
    expect(selectSingleFocusProject({ projectIds: ['a'], except: false })).toBe('a');
    expect(selectSingleFocusProject({ projectIds: ['a'], except: true })).toBeNull();
    expect(selectSingleFocusProject({ projectIds: ['a', 'b'], except: false })).toBeNull();
    expect(selectSingleFocusProject(NO_FOCUS_PROJECTS)).toBeNull();
  });

  test('sorts and dedupes the projects, and drops all but when none are left out', () => {
    expect(normaliseFocusProjects(['b', 'a', 'b'], true)).toEqual({ projectIds: ['a', 'b'], except: true });
    expect(normaliseFocusProjects([], true)).toEqual(NO_FOCUS_PROJECTS);
  });

  test('reads the one-project focus an older engine sends', () => {
    expect(resolveFocusSelection({ projectId: 'a' })).toEqual({ projectIds: ['a'], except: false });
    expect(resolveFocusSelection({ projectId: null })).toEqual(NO_FOCUS_PROJECTS);
    expect(isProjectInFocus({ projectId: 'a' }, 'b')).toBe(false);
  });
});
