import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  AUTO_CHOICES,
  createNewTaskCommand,
  describeAfterLabel,
  describeNewTask,
  listNewTaskPriorities,
  listNewTaskProjects,
  listNewTaskStarts,
  NO_PROJECT,
  requestNewTask,
  resolveProjectChoice,
  resolveShownProject,
  resolveStartChoice,
  toggleAfterTask,
  useNewTaskRequest,
} from '@/lib/new-task.ts';
import { createShinsaState, createTask } from '../support/state.ts';

describe('useNewTaskRequest', () => {
  it('hands a draft requested before mount to the composer once it mounts', () => {
    requestNewTask('Fix the login page');
    const apply = mock((_draft: string) => {});
    renderHook(() => useNewTaskRequest(apply));
    expect(apply).toHaveBeenCalledWith('Fix the login page');
  });

  it('hands over a draft requested while mounted, once', () => {
    const apply = mock((_draft: string) => {});
    renderHook(() => useNewTaskRequest(apply));
    expect(apply).not.toHaveBeenCalled();
    act(() => requestNewTask());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('');
  });

  it('uses the latest callback without resubscribing', () => {
    const first = mock((_draft: string) => {});
    const second = mock((_draft: string) => {});
    const { rerender } = renderHook(({ apply }) => useNewTaskRequest(apply), {
      initialProps: { apply: first },
    });
    rerender({ apply: second });
    act(() => requestNewTask('Add tests'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('Add tests');
  });

  it('keeps a draft for the next composer after the last one unmounts', () => {
    const gone = mock((_draft: string) => {});
    const { unmount } = renderHook(() => useNewTaskRequest(gone));
    unmount();
    requestNewTask('Later');
    expect(gone).not.toHaveBeenCalled();
    const next = mock((_draft: string) => {});
    renderHook(() => useNewTaskRequest(next));
    expect(next).toHaveBeenCalledWith('Later');
  });
});

describe('describeNewTask', () => {
  it('words the composer the same for every task, Add when it waits or goes to the backlog', () => {
    const started = {
      placeholder: 'Describe the work or ask a question. Shinsa decides what kind of task it is.',
      submit: 'Start',
      done: 'Started. It comes back when it needs a decision.',
    };
    expect(describeNewTask('auto')).toEqual(started);
    expect(describeNewTask('now')).toEqual(started);
    expect(describeNewTask('after')).toMatchObject({
      submit: 'Add',
      done: 'Added. It starts when the tasks it waits on are finished.',
    });
    expect(describeNewTask('backlog')).toMatchObject({
      submit: 'Add',
      done: 'Added to the backlog. It plans now and builds when you start it.',
    });
  });
});

describe('createNewTaskCommand', () => {
  it('leaves every Auto part out, so triage decides it', () => {
    expect(createNewTaskCommand(' Fix it ', AUTO_CHOICES)).toEqual({
      type: 'task.create',
      request: 'Fix it',
      repoId: null,
    });
  });

  it('sends each part you picked, Start now as no tasks to wait on and No project as null', () => {
    expect(
      createNewTaskCommand('Fix it', { project: 'p1', start: 'now', after: [], priority: 'urgent' })
    ).toEqual({
      type: 'task.create',
      request: 'Fix it',
      repoId: null,
      projectId: 'p1',
      priority: 'urgent',
      waitsOn: [],
    });
    expect(
      createNewTaskCommand('Fix it', { ...AUTO_CHOICES, start: 'after', after: ['a', 'b'] })
    ).toMatchObject({
      waitsOn: ['a', 'b'],
    });
    expect(createNewTaskCommand('Fix it', { ...AUTO_CHOICES, start: 'backlog' })).toEqual({
      type: 'task.create',
      request: 'Fix it',
      repoId: null,
      backlog: true,
    });
    expect(createNewTaskCommand('Fix it', { ...AUTO_CHOICES, project: NO_PROJECT })).toEqual({
      type: 'task.create',
      request: 'Fix it',
      repoId: null,
      projectId: null,
    });
  });
});

describe('the composer’s choices', () => {
  it('lead with Auto, then every priority', () => {
    expect(listNewTaskPriorities().map((item) => [item.value, item.label])).toEqual([
      ['auto', 'Auto priority'],
      ['urgent', 'Urgent'],
      ['high', 'High priority'],
      ['normal', 'Normal priority'],
      ['low', 'Low priority'],
    ]);
  });

  it('offer four ways to start, each with its hint, and name the tasks it waits for', () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const starts = listNewTaskStarts([base], []);
    expect(starts.map((item) => [item.value, item.label, item.hint])).toEqual([
      ['auto', 'Auto start', 'Now, or after work it builds on'],
      ['now', 'Start now', 'Now, even if related work is open'],
      ['after', 'After another task…', 'When the tasks you pick finish'],
      ['backlog', 'Backlog', 'Plans now, builds when you start it'],
    ]);
    expect(starts[2]?.disabled).toBeUndefined();
    expect(listNewTaskStarts([base], ['base'])[2]?.label).toBe('After Fix the schema');
    expect(listNewTaskStarts([], [])[2]?.disabled).toBe('No open task to wait for');
  });

  it('name one task, or the first and how many more', () => {
    expect(describeAfterLabel([])).toBe('After another task…');
    expect(describeAfterLabel([{ title: 'A' }])).toBe('After A');
    expect(describeAfterLabel([{ title: 'A' }, { title: 'B' }, { title: 'C' }])).toBe('After A and 2 more');
  });

  it('keep only open tasks to wait for, and fall back to Auto start when none is left', () => {
    const open = [createTask({ id: 'a' })];
    expect(resolveStartChoice({ start: 'after', after: ['a', 'gone'] }, open)).toEqual({
      start: 'after',
      after: ['a'],
    });
    expect(resolveStartChoice({ start: 'after', after: ['gone'] }, open)).toEqual({
      start: 'auto',
      after: [],
    });
    expect(resolveStartChoice({ start: 'backlog', after: [] }, open)).toEqual({
      start: 'backlog',
      after: [],
    });
  });

  it('toggle a task in and out of what it waits for', () => {
    expect(toggleAfterTask([], 'a')).toEqual({ start: 'after', after: ['a'] });
    expect(toggleAfterTask(['a', 'b'], 'a')).toEqual({ start: 'after', after: ['b'] });
    expect(toggleAfterTask(['a'], 'a')).toEqual({ start: 'auto', after: [] });
  });
});

describe('the project choice', () => {
  const state = createShinsaState({
    patch: {
      projects: {
        p1: { id: 'p1', name: 'Superwall', color: 'blue', key: 'SUP', description: '', folders: [] },
        p2: { id: 'p2', name: 'Basket', color: 'green', key: 'BAS', description: '', folders: [] },
      },
    },
  });

  it('offers No project, then every project by name with its colour', () => {
    expect(listNewTaskProjects(state)).toEqual([
      { value: NO_PROJECT, label: 'No project', color: 'gray' },
      { value: 'p2', label: 'Basket', color: 'green' },
      { value: 'p1', label: 'Superwall', color: 'blue' },
    ]);
  });

  it('shows the focus project until you pick, and No project without a focus', () => {
    const focused = { ...state, focus: { projectId: 'p1', until: null } };
    expect(resolveShownProject(focused, 'auto')).toBe('p1');
    expect(resolveShownProject(state, 'auto')).toBe(NO_PROJECT);
    expect(resolveShownProject(focused, NO_PROJECT)).toBe(NO_PROJECT);
    expect(resolveShownProject(focused, 'p2')).toBe('p2');
  });

  it('forgets a pick whose project was removed', () => {
    expect(['p2', NO_PROJECT, 'gone'].map((project) => resolveProjectChoice(state, project))).toEqual([
      'p2',
      NO_PROJECT,
      'auto',
    ]);
  });
});
