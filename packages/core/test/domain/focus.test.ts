import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  describeFocusProjects,
  isProjectInFocus,
  NO_FOCUS_PROJECTS,
  normaliseFocusProjects,
  resolveFocusSelection,
  selectSingleFocusProject,
  serializeNames,
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
    expect(Option.getOrNull(selectSingleFocusProject({ projectIds: ['a'], except: false }))).toBe('a');
    expect(Option.getOrNull(selectSingleFocusProject({ projectIds: ['a'], except: true }))).toBeNull();
    expect(Option.getOrNull(selectSingleFocusProject({ projectIds: ['a', 'b'], except: false }))).toBeNull();
    expect(Option.getOrNull(selectSingleFocusProject(NO_FOCUS_PROJECTS))).toBeNull();
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

  test('names the projects in focus in order, all but some, or nothing it knows', () => {
    const names: Record<string, string> = { a: 'Work', b: 'Home', c: 'Shinsa' };
    const nameOf = (projectId: string) => names[projectId];
    expect(serializeNames([])).toBe('');
    expect(serializeNames(['Work'])).toBe('Work');
    expect(serializeNames(['Home', 'Shinsa', 'Work'])).toBe('Home, Shinsa and Work');
    expect(Option.getOrNull(describeFocusProjects({ projectIds: ['a', 'b'], except: false }, nameOf))).toBe(
      'Home and Work'
    );
    expect(Option.getOrNull(describeFocusProjects({ projectIds: ['a'], except: true }, nameOf))).toBe(
      'everything but Work'
    );
    expect(Option.getOrNull(describeFocusProjects({ projectId: 'c' }, nameOf))).toBe('Shinsa');
    expect(
      Option.getOrNull(describeFocusProjects({ projectIds: ['gone'], except: true }, nameOf))
    ).toBeNull();
    expect(Option.getOrNull(describeFocusProjects(NO_FOCUS_PROJECTS, nameOf))).toBeNull();
  });
});
