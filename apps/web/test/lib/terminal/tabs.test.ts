import { describe, expect, it } from 'bun:test';
import {
  countTerminalsByFilter,
  describeFilterEmpty,
  describeFindResults,
  describeTerminalClose,
  describeTerminalEnd,
  describeTerminalTab,
  groupTerminalPlaces,
  listProjectTerminals,
  listShownTerminals,
  moveTerminal,
  rememberTerminalPath,
  resolveActiveTerminal,
  resolveDefaultPlace,
  resolveFilterLabel,
  resolveNewTerminalPlace,
  resolveTerminalAfterClose,
  resolveTerminalEntry,
  resolveTerminalPath,
  resolveTerminalProject,
  resolveTerminalTabLabel,
  resolveTerminalTaskHandle,
  showsServices,
} from '@/lib/terminal/tabs.ts';
import { NOW } from '../../support/state.ts';
import { createTerminal, createTerminalState, createTerminalsSnapshot } from '../../support/terminals.ts';

const STATE = createTerminalState();

const ONE = createTerminal({ id: 'one' });
const TWO = createTerminal({ id: 'two' });
const THREE = createTerminal({ id: 'three' });
const OTHER = createTerminal({ id: 'other', projectId: 'docs' });

describe('resolveTerminalPath and the entry the nav opens', () => {
  it('names the project by its key and the terminal by its id', () => {
    expect(resolveTerminalPath('SH')).toBe('/terminal?project=SH');
    expect(resolveTerminalPath('SH', 'one')).toBe('/terminal?project=SH&terminal=one');
  });

  it('remembers the last terminal you looked at, and nothing that is not one', () => {
    rememberTerminalPath('/terminal?project=SH&terminal=one');
    expect(resolveTerminalEntry()).toBe('/terminal?project=SH&terminal=one');
    rememberTerminalPath('/settings');
    expect(resolveTerminalEntry()).toBe('/terminal');
  });
});

describe('resolveTerminalProject', () => {
  it('opens the project the URL names, by key in any case or by id', () => {
    expect(resolveTerminalProject(STATE, 'sh', NOW)?.id).toBe('shop');
    expect(resolveTerminalProject(STATE, 'docs', NOW)?.id).toBe('docs');
  });

  it('falls back to the focus project, then the first project by name, then none', () => {
    const focused = { ...STATE, focus: { projectIds: ['shop'], except: false, teamId: null, until: null } };
    expect(resolveTerminalProject(focused, 'nope', NOW)?.id).toBe('shop');
    expect(
      resolveTerminalProject(
        { ...STATE, focus: { projectIds: ['gone'], except: false, teamId: null, until: null } },
        null,
        NOW
      )?.id
    ).toBe('docs');
    expect(resolveTerminalProject({ ...STATE, projects: {} }, null, NOW)).toBeNull();
  });
});

describe('the tabs', () => {
  it('lists a project’s terminals in the engine’s order', () => {
    const snapshot = createTerminalsSnapshot([ONE, OTHER, TWO]);
    expect(listProjectTerminals(snapshot, 'shop')).toEqual([ONE, TWO]);
    expect(listProjectTerminals(null, 'shop')).toEqual([]);
    expect(listProjectTerminals(snapshot, null)).toEqual([]);
  });

  it('shows the terminal the URL names, else the first', () => {
    expect(resolveActiveTerminal([ONE, TWO], 'two')).toBe(TWO);
    expect(resolveActiveTerminal([ONE, TWO], 'gone')).toBe(ONE);
    expect(resolveActiveTerminal([], null)).toBeNull();
  });

  it('moves on to the tab on the right after a close, else the one on the left', () => {
    expect(resolveTerminalAfterClose([ONE, TWO, THREE], 'two')).toBe(THREE);
    expect(resolveTerminalAfterClose([ONE, TWO], 'two')).toBe(ONE);
    expect(resolveTerminalAfterClose([ONE], 'one')).toBeNull();
    expect(resolveTerminalAfterClose([ONE], 'gone')).toBeNull();
  });

  it('drops a dragged tab where the tab it lands on was', () => {
    expect(moveTerminal(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveTerminal(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveTerminal(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveTerminal(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
  });
});

describe('places', () => {
  it('groups a project’s places by kind, in a fixed order', () => {
    expect(
      groupTerminalPlaces(STATE, 'shop').map((group) => [
        group.heading,
        group.places.map((place) => place.label),
      ])
    ).toEqual([
      ['Repositories', ['api', 'web']],
      ['Folders', ['notes']],
      ['Task worktrees', ['SH-4 Fix the cart']],
    ]);
    expect(groupTerminalPlaces(STATE, 'shop').map((group) => group.icon)).toEqual([
      {
        name: 'IconFolder1',
        style: Object.fromEntries([['--icon-color', `var(--${STATE.projects.shop?.color}-4, var(--fg-2))`]]),
      },
      'IconFolders',
      'IconBranch',
    ]);
  });

  it('opens a new terminal in the first place, or the home folder for a project with none', () => {
    expect(resolveDefaultPlace(STATE, 'shop', '/Users/you')?.label).toBe('api');
    expect(resolveDefaultPlace(STATE, 'docs', '/Users/you')).toEqual({
      path: '/Users/you',
      label: 'Home folder',
      kind: 'folder',
      taskId: null,
    });
    expect(resolveDefaultPlace(STATE, 'docs', null)).toBeNull();
  });
});

describe('the words', () => {
  it('says how a shell ended, and nothing while it runs', () => {
    expect(describeTerminalEnd(ONE)).toBeNull();
    expect(describeTerminalEnd({ ...ONE, status: 'exited', exitCode: 0 })).toBe('The shell exited.');
    expect(describeTerminalEnd({ ...ONE, status: 'exited', exitCode: null })).toBe('The shell exited.');
    expect(describeTerminalEnd({ ...ONE, status: 'exited', exitCode: 2 })).toBe(
      'The shell exited with code 2.'
    );
    expect(describeTerminalEnd({ ...ONE, status: 'stopped' })).toContain('engine restarted');
  });

  it('names a tab’s folder and how it ended in its tooltip', () => {
    expect(describeTerminalTab(ONE)).toBe('/Users/you/Developer/web');
    expect(describeTerminalTab({ ...ONE, status: 'exited', exitCode: 1 })).toBe(
      'Exited with code 1 · /Users/you/Developer/web'
    );
    expect(describeTerminalTab({ ...ONE, status: 'exited', exitCode: 0 })).toStartWith('Exited ·');
    expect(describeTerminalTab({ ...ONE, status: 'stopped' })).toStartWith('Ended when the engine restarted');
  });

  it('names a task’s terminal and a service’s run for a task with the task’s handle', () => {
    expect(resolveTerminalTaskHandle({ ...ONE, taskId: 'fix' }, { fix: { handle: 'SH-4' } })).toBe('SH-4');
    expect(resolveTerminalTaskHandle(ONE, { fix: { handle: 'SH-4' } })).toBeNull();
    const tasks = { fix: { handle: 'SH-4' }, raw: { handle: null } };
    const run = { ...ONE, name: 'api', serviceId: 'api', taskId: 'fix' };
    expect(resolveTerminalTabLabel(run, tasks)).toBe('api · SH-4');
    expect(resolveTerminalTabLabel({ ...run, taskId: 'raw' }, tasks)).toBe('api');
    expect(resolveTerminalTabLabel({ ...run, taskId: null }, tasks)).toBe('api');
    expect(resolveTerminalTabLabel({ ...run, serviceId: null }, tasks)).toBe('api · SH-4');
  });

  it('warns what closing a terminal with a program in front stops', () => {
    expect(describeTerminalClose({ ...ONE, name: 'Server' }, 'vim')).toBe(
      'vim is still running in “Server”. Closing the terminal stops it, and its scrollback is gone.'
    );
  });

  it('says how a service ended, by its name', () => {
    const service = { ...ONE, name: 'api', serviceId: 'api' };
    expect(describeTerminalEnd({ ...service, status: 'stopped' })).toBe(
      'api is stopped. Its last output is above.'
    );
    expect(describeTerminalEnd({ ...service, status: 'exited', exitCode: 0 })).toBe('api exited.');
    expect(describeTerminalEnd({ ...service, status: 'exited', exitCode: 1 })).toBe(
      'api exited with code 1.'
    );
    expect(describeTerminalEnd({ ...service, status: 'exited', exitCode: null })).toBe(
      'api ended without an exit code.'
    );
  });

  it('opens a new tab where the one you are on is, else in the project’s first place', () => {
    const groups = groupTerminalPlaces(STATE, 'shop');
    const fallback = resolveDefaultPlace(STATE, 'shop', '/Users/you');
    const notes = groups.flatMap((group) => group.places).find((place) => place.label === 'notes');
    expect(resolveNewTerminalPlace({ ...ONE, cwd: notes?.path ?? '' }, groups, fallback)).toEqual(
      notes ?? null
    );
    expect(resolveNewTerminalPlace({ ...ONE, cwd: '/elsewhere' }, groups, fallback)).toEqual(fallback);
    expect(resolveNewTerminalPlace(null, groups, fallback)).toEqual(fallback);
  });

  it('counts the matches of a find', () => {
    expect(describeFindResults(null, 'x')).toBe('');
    expect(describeFindResults({ index: 0, count: 3 }, '')).toBe('');
    expect(describeFindResults({ index: -1, count: 0 }, 'x')).toBe('No results');
    expect(describeFindResults({ index: 1, count: 3 }, 'x')).toBe('2 of 3');
    expect(describeFindResults({ index: -1, count: 3 }, 'x')).toBe('3 found');
  });
});

describe('the filter', () => {
  const MINE = createTerminal({ id: 'mine' });
  const TASK = createTerminal({ id: 'task', taskId: 'task-1' });
  const SERVICE = createTerminal({ id: 'svc', serviceId: 'api' });
  const TASK_SERVICE = createTerminal({ id: 'task-svc', serviceId: 'api', taskId: 'task-1' });
  const ALL = [MINE, TASK, SERVICE, TASK_SERVICE];
  const ids = (terminals: { id: string }[]) => terminals.map((terminal) => terminal.id);

  it('shows your terminals, a task’s or the services, and every one under All', () => {
    expect(ids(listShownTerminals(ALL, 'yours', null))).toEqual(['mine']);
    expect(ids(listShownTerminals(ALL, 'tasks', null))).toEqual(['task']);
    expect(ids(listShownTerminals(ALL, 'services', null))).toEqual(['svc', 'task-svc']);
    expect(ids(listShownTerminals(ALL, 'all', null))).toEqual(['mine', 'task', 'svc', 'task-svc']);
  });

  it('keeps the terminal the URL names in its place, whatever the filter', () => {
    expect(ids(listShownTerminals(ALL, 'yours', 'task'))).toEqual(['mine', 'task']);
    expect(ids(listShownTerminals(ALL, 'services', 'mine'))).toEqual(['mine', 'svc', 'task-svc']);
  });

  it('counts the terminals under each filter', () => {
    expect(countTerminalsByFilter(ALL)).toEqual({ yours: 1, tasks: 1, services: 2, all: 4 });
    expect(countTerminalsByFilter([])).toEqual({ yours: 0, tasks: 0, services: 0, all: 0 });
  });

  it('names each filter, says what an empty one means, and shows services only where they are listed', () => {
    expect(resolveFilterLabel('yours')).toBe('Your terminals');
    expect(resolveFilterLabel('services')).toBe('Services');
    expect(describeFilterEmpty('yours', 'Shop').title).toBe('No terminals of yours in Shop');
    expect(describeFilterEmpty('tasks', 'Shop').title).toBe('No task terminals in Shop');
    expect(describeFilterEmpty('services', 'Shop').title).toBe('No services running in Shop');
    expect(describeFilterEmpty('all', 'Shop').title).toBe('No terminals in Shop');
    expect([
      showsServices('yours'),
      showsServices('tasks'),
      showsServices('services'),
      showsServices('all'),
    ]).toEqual([false, false, true, true]);
  });
});
