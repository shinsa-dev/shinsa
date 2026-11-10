import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { resolveServicePlace, resolveTerminalStart } from '../../src/terminals/places.ts';
import { createTempDir } from '../helpers/index.ts';

describe('resolveTerminalStart', () => {
  test('opens in your home folder only for a project with no folders at all', () => {
    const home = createTempDir();
    expect(Result.getOrThrow(resolveTerminalStart([], 'p1', home, home))).toEqual({
      projectId: 'p1',
      cwd: home,
      place: 'folder',
      taskId: null,
    });
    expect(Result.flip(resolveTerminalStart([], 'p1', '/tmp', home))).toMatchObject({
      success: {
        _tag: 'DomainError',
        code: 'terminal_place_invalid',
        message: 'Pick one of the project’s folders.',
      },
    });
  });
});

describe('resolveServicePlace', () => {
  test('runs in a repository or folder of the project, or a folder inside one, never a worktree', () => {
    const places = [
      { path: '/code/web', label: 'web', kind: 'repository', taskId: null },
      { path: '/notes/', label: 'notes', kind: 'folder', taskId: null },
      { path: '/wt/a', label: 'A', kind: 'worktree', taskId: 'a' },
    ] as const;
    expect(resolveServicePlace([...places], '/code/web/apps/api', '/home')).toBe('repository');
    expect(resolveServicePlace([...places], '/notes', '/home')).toBe('folder');
    expect(resolveServicePlace([...places], '/code/website', '/home')).toBeNull();
    expect(resolveServicePlace([...places], '/wt/a', '/home')).toBeNull();
    expect(resolveServicePlace([], '/home/x', '/home')).toBe('folder');
    expect(resolveServicePlace([...places], '/home/x', '/home')).toBeNull();
  });
});
