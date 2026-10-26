import { describe, expect, it } from 'bun:test';
import {
  listTerminalPlaces,
  parseTerminalClientFrame,
  parseTerminalServerFrame,
  resolveTaskTerminalPlace,
  resolveTerminalLabel,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';

function task(id: string, extra: Partial<Task>) {
  return { id, title: `Task ${id}`, stage: 'building', handle: null, repoId: null, ...extra } as Task;
}

const STATE = {
  repos: {
    web: { id: 'web', name: 'web', path: '/code/web', projectId: 'p1' },
    api: { id: 'api', name: 'api', path: '/code/api', projectId: 'p1' },
    other: { id: 'other', name: 'other', path: '/code/other', projectId: 'p2' },
  },
  projects: {
    p1: { id: 'p1', name: 'Shop', folders: ['/notes/', '/code/web'] },
    p2: { id: 'p2', name: 'Other', folders: [] },
  },
  tasks: {
    building: task('building', { handle: 'SH-4', repoId: 'web', worktreePath: '/wt/building' }),
    plain: task('plain', { repoId: 'api', worktreePath: '/wt/plain' }),
    done: task('done', { repoId: 'web', worktreePath: '/wt/done', stage: 'merged' }),
    elsewhere: task('elsewhere', { repoId: 'other', worktreePath: '/wt/elsewhere' }),
    bare: task('bare', { repoId: 'web', worktreePath: null }),
  },
} as unknown as ShinsaState;

describe('listTerminalPlaces', () => {
  it('lists a project’s repositories by name, its folders, then the worktrees of its open tasks, each once', () => {
    expect(listTerminalPlaces(STATE, 'p1')).toEqual([
      { path: '/code/api', label: 'api', kind: 'repository', taskId: null },
      { path: '/code/web', label: 'web', kind: 'repository', taskId: null },
      { path: '/notes/', label: 'notes', kind: 'folder', taskId: null },
      { path: '/wt/building', label: 'SH-4 Task building', kind: 'worktree', taskId: 'building' },
      { path: '/wt/plain', label: 'Task plain', kind: 'worktree', taskId: 'plain' },
    ]);
  });

  it('has nothing for a project without places or one it does not know', () => {
    expect(listTerminalPlaces(STATE, 'p2').map((place) => place.path)).toEqual([
      '/code/other',
      '/wt/elsewhere',
    ]);
    expect(listTerminalPlaces(STATE, 'gone')).toEqual([]);
  });
});

describe('resolveTaskTerminalPlace', () => {
  it('opens in the task’s worktree, else its repository, else nowhere', () => {
    expect(resolveTaskTerminalPlace(STATE, STATE.tasks.building as Task)?.path).toBe('/wt/building');
    expect(resolveTaskTerminalPlace(STATE, STATE.tasks.bare as Task)).toEqual({
      path: '/code/web',
      label: 'web',
      kind: 'repository',
      taskId: null,
    });
    expect(resolveTaskTerminalPlace(STATE, task('none', {}))).toBeNull();
  });
});

describe('resolveTerminalLabel', () => {
  it('prefers the name you gave it, then the shell’s title, then the folder', () => {
    expect(resolveTerminalLabel({ name: 'Server', title: 'fish', cwd: '/code/web' })).toBe('Server');
    expect(resolveTerminalLabel({ name: null, title: 'bun dev', cwd: '/code/web' })).toBe('bun dev');
    expect(resolveTerminalLabel({ name: null, title: null, cwd: '/code/web/' })).toBe('web');
    expect(resolveTerminalLabel({ name: null, title: null, cwd: '/' })).toBe('/');
  });
});

describe('parseTerminalClientFrame', () => {
  it('reads a resize within the limits', () => {
    expect(parseTerminalClientFrame('{"type":"resize","cols":120,"rows":40}')).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
    expect(parseTerminalClientFrame('{"type":"resize","cols":0,"rows":40}')).toBeNull();
    expect(parseTerminalClientFrame('{"type":"resize","cols":12.5,"rows":40}')).toBeNull();
    expect(parseTerminalClientFrame('{"type":"resize","cols":5000,"rows":40}')).toBeNull();
  });

  it('reads the page’s colours only as hex', () => {
    const colors = { foreground: '#111111', background: '#FFFFFF', cursor: '#0055ff' };
    expect(parseTerminalClientFrame(JSON.stringify({ type: 'colors', colors }))).toEqual({
      type: 'colors',
      colors,
    });
    expect(
      parseTerminalClientFrame(JSON.stringify({ type: 'colors', colors: { ...colors, cursor: 'red' } }))
    ).toBeNull();
    expect(parseTerminalClientFrame('{"type":"colors","colors":null}')).toBeNull();
  });

  it('reads a request to clear the scrollback', () => {
    expect(parseTerminalClientFrame('{"type":"clear"}')).toEqual({ type: 'clear' });
  });

  it('ignores anything else', () => {
    expect(parseTerminalClientFrame('not json')).toBeNull();
    expect(parseTerminalClientFrame('null')).toBeNull();
    expect(parseTerminalClientFrame('{"type":"input"}')).toBeNull();
  });
});

describe('parseTerminalServerFrame', () => {
  it('reads a reset with the terminal’s size, the end of the screen and nothing else', () => {
    expect(parseTerminalServerFrame('{"type":"reset","cols":80,"rows":24}')).toEqual({
      type: 'reset',
      cols: 80,
      rows: 24,
    });
    expect(parseTerminalServerFrame('{"type":"live"}')).toEqual({ type: 'live' });
    expect(parseTerminalServerFrame('{"type":"reset","cols":80}')).toBeNull();
    expect(parseTerminalServerFrame('{"type":"other"}')).toBeNull();
    expect(parseTerminalServerFrame('null')).toBeNull();
    expect(parseTerminalServerFrame('{')).toBeNull();
  });
});
