import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  AUTO_CHOICES,
  createNewTaskCommand,
  describeAfterLabel,
  describeMachineLoad,
  describeNewTask,
  describePlacementDone,
  describeStackLabel,
  hasMachineChoice,
  isProjectOnMachine,
  listNewTaskMachines,
  listNewTaskPriorities,
  listNewTaskProjects,
  listNewTaskStarts,
  NO_PROJECT,
  requestNewTask,
  requestPolicyPlacement,
  resolveNewTaskMachine,
  resolveProjectChoice,
  resolveShownProject,
  resolveStartChoice,
  toggleAfterTask,
  toggleStackTask,
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
      done: 'Task started.',
    };
    expect(describeNewTask('auto')).toEqual(started);
    expect(describeNewTask('now')).toEqual(started);
    expect(describeNewTask('after')).toMatchObject({
      submit: 'Add',
      done: 'Task added.',
    });
    expect(describeNewTask('backlog')).toMatchObject({
      submit: 'Add',
      done: 'Added to the backlog.',
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
      createNewTaskCommand('Fix it', {
        project: 'p1',
        start: 'now',
        after: [],
        priority: 'urgent',
        machine: 'auto',
      })
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

  it('offer five ways to start, each with its hint, and name the tasks it waits for', () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const starts = listNewTaskStarts([base], []);
    expect(starts.map((item) => [item.value, item.label, item.hint])).toEqual([
      ['auto', 'Auto start', 'Now, or after work it builds on'],
      ['now', 'Start now', 'Now, even if related work is open'],
      ['after', 'After another task…', 'When the tasks you pick finish'],
      ['stack', 'Stack on another task…', 'When it is ready to merge, as one bundle'],
      ['backlog', 'Backlog', 'Plans now, builds when you start it'],
    ]);
    expect(starts[3]?.disabled).toBe('No open task with a pull request to stack on');
    const stacked = listNewTaskStarts([base], ['base'], [base])[3];
    expect(stacked?.label).toBe('Stacked on Fix the schema');
    expect(stacked?.disabled).toBeUndefined();
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

  it('stack on one task at a time, and keep it only while it can still be stacked on', () => {
    const open = [createTask({ id: 'a' }), createTask({ id: 'b' })];
    const stackable = [createTask({ id: 'a' })];
    expect(toggleStackTask([], 'a')).toEqual({ start: 'stack', after: ['a'] });
    expect(toggleStackTask(['b'], 'a')).toEqual({ start: 'stack', after: ['a'] });
    expect(toggleStackTask(['a'], 'a')).toEqual({ start: 'auto', after: [] });
    expect(resolveStartChoice({ start: 'stack', after: ['a'] }, open, stackable)).toEqual({
      start: 'stack',
      after: ['a'],
    });
    expect(resolveStartChoice({ start: 'stack', after: ['b'] }, open, stackable)).toEqual({
      start: 'auto',
      after: [],
    });
    expect(describeStackLabel(undefined)).toBe('Stack on another task…');
    expect(describeNewTask('stack').submit).toBe('Add');
    expect(createNewTaskCommand('Add the screen', { ...AUTO_CHOICES, start: 'stack', after: ['a'] })).toEqual(
      {
        type: 'task.create',
        request: 'Add the screen',
        repoId: null,
        stacksOn: 'a',
      }
    );
    expect(createNewTaskCommand('Add it', { ...AUTO_CHOICES, start: 'stack', after: [] })).toEqual({
      type: 'task.create',
      request: 'Add it',
      repoId: null,
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

  it('names the machine of each project when the dashboard spans several', () => {
    const machine = (id: string) => (id === 'p2' ? { name: 'Laptop' } : { name: 'Studio' });
    expect(listNewTaskProjects(state, machine).map((item) => item.label)).toEqual([
      'No project',
      'Basket on Laptop',
      'Superwall on Studio',
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

function createMachine(id: string, open: number, capacity: number | null, projects: string[] = []) {
  return {
    id,
    name: id === 'studio' ? 'Studio' : 'Build box',
    state: {
      tasks: Object.fromEntries(
        Array.from({ length: open }, (_, index) => [`${id}-${index}`, { stage: 'building' as const }])
      ),
      projects: Object.fromEntries(projects.map((project) => [project, {}])),
      settings: { taskCapacity: capacity },
    },
  };
}

describe('the machine a new task runs on', () => {
  const studio = { ...createMachine('studio', 3, 4, ['p1']), current: true };
  const box = { ...createMachine('box', 1, null), current: false };
  const ruled = {
    ...box,
    state: {
      ...box.state,
      settings: { taskCapacity: null, placementPolicies: ['Run benchmarks on the build box.'] },
    },
  };
  const auto = { machine: 'auto', project: 'auto' } as const;

  it('picks nothing with one machine, the project you pick, then the focus project or the most room', () => {
    expect(resolveNewTaskMachine([studio], auto, 'p1')).toBeNull();
    expect(resolveNewTaskMachine([studio, box], auto, 'p1')).toEqual({ id: 'studio', byPolicy: false });
    expect(resolveNewTaskMachine([studio, box], auto, NO_PROJECT)).toEqual({ id: 'box', byPolicy: false });
    expect(resolveNewTaskMachine([studio, box], { ...auto, machine: 'studio' }, NO_PROJECT)).toEqual({
      id: 'studio',
      byPolicy: false,
    });
    expect(resolveNewTaskMachine([studio, box], { ...auto, machine: 'gone' }, NO_PROJECT)).toEqual({
      id: 'box',
      byPolicy: false,
    });
    expect(resolveNewTaskMachine([], { ...auto, machine: 'x' }, NO_PROJECT)).toBeNull();
  });

  it('leaves Automatic to the policies when there are any and you named no project or machine', () => {
    expect(resolveNewTaskMachine([studio, ruled], auto, 'p1')).toEqual({ id: 'studio', byPolicy: true });
    expect(resolveNewTaskMachine([studio, ruled], { ...auto, project: 'p1' }, 'p1')).toEqual({
      id: 'studio',
      byPolicy: false,
    });
    expect(resolveNewTaskMachine([studio, ruled], { ...auto, machine: 'box' }, NO_PROJECT)).toEqual({
      id: 'box',
      byPolicy: false,
    });
  });

  it('asks the engine which machine the policies send a request to, and falls back on no answer', async () => {
    const asked: unknown[] = [];
    const answer = { machineId: 'box', reason: 'Benchmarks run on the build box.' };
    expect(
      await requestPolicyPlacement([studio, ruled], 'Run the benchmark', (question) => {
        asked.push(question);
        return Promise.resolve({ answer });
      })
    ).toEqual({ answer, failed: false });
    expect(asked).toEqual([
      {
        request: 'Run the benchmark',
        machines: [
          { id: 'studio', name: 'Studio', policies: [], open: 3, capacity: 4 },
          {
            id: 'box',
            name: 'Build box',
            policies: ['Run benchmarks on the build box.'],
            open: 1,
            capacity: null,
          },
        ],
      },
    ]);
    expect(
      await requestPolicyPlacement([studio, ruled], 'x', () => Promise.resolve({ answer: null }))
    ).toEqual({ answer: null, failed: false });
    expect(
      await requestPolicyPlacement([studio, ruled], 'x', () =>
        Promise.reject(new Error('No Claude account is signed in.'))
      )
    ).toEqual({ answer: null, failed: true });
  });

  it('asks the machine in front by POST /api/placement', async () => {
    const answer = { machineId: 'box', reason: 'Benchmarks run on the build box.' };
    const realFetch = globalThis.fetch;
    const posted: string[] = [];
    globalThis.fetch = mock((url: string) => {
      posted.push(url);
      return Promise.resolve(Response.json({ answer }));
    }) as unknown as typeof globalThis.fetch;
    const placed = await requestPolicyPlacement([studio, ruled], 'Run the benchmark');
    globalThis.fetch = realFetch;
    expect(placed).toEqual({ answer, failed: false });
    expect(posted).toEqual(['/api/placement']);
  });

  it('says in the toast which machine took the task', () => {
    expect(describePlacementDone('Task started.', box)).toBe('Task started. Runs on Build box.');
    expect(describePlacementDone('Task started.', studio)).toBe('Task started. Runs on This machine.');
    expect(describePlacementDone('Task started.', undefined)).toBe('Task started.');
  });

  it('lists Automatic, with the policies’ hint when they decide, then each machine with its load', () => {
    expect(listNewTaskMachines([studio, box], { id: 'box', byPolicy: false })).toEqual([
      { value: 'auto', label: 'Automatic', icon: 'IconArrowSplitRight' },
      { value: 'studio', label: 'This machine', icon: 'IconMacbookRemote', hint: '3 of 4 open tasks' },
      { value: 'box', label: 'Build box', icon: 'IconMacbookRemote', hint: '1 open task' },
    ]);
    expect(listNewTaskMachines([studio, box], { id: 'box', byPolicy: true })[0]).toEqual({
      value: 'auto',
      label: 'Automatic',
      icon: 'IconArrowSplitRight',
      hint: 'Your routing policies decide when you start it',
    });
    expect(listNewTaskMachines([studio, box], null)[0]?.label).toBe('Automatic');
  });

  it('shows a machine this device cannot reach, disabled, and picks the one it can', () => {
    const laptop = { id: 'laptop', name: 'Laptop' };
    expect(hasMachineChoice([box], [])).toBe(false);
    expect(hasMachineChoice([box], [laptop])).toBe(true);
    expect(listNewTaskMachines([box], null, [laptop, { id: 'box', name: 'Build box' }])).toEqual([
      { value: 'auto', label: 'Automatic', icon: 'IconArrowSplitRight' },
      { value: 'box', label: 'Build box', icon: 'IconMacbookRemote', hint: '1 open task' },
      {
        value: 'laptop',
        label: 'Laptop',
        icon: 'IconMacbookRemote',
        disabled: 'Add this device on Laptop first',
      },
    ]);
    expect(describeMachineLoad({ open: 4, capacity: 4, full: true })).toBe('4 of 4 open tasks, full');
  });

  it('offers only the projects of the machine a task goes to', () => {
    expect(isProjectOnMachine([studio, box], null, 'p1')).toBe(true);
    expect(isProjectOnMachine([studio, box], 'studio', 'p1')).toBe(true);
    expect(isProjectOnMachine([studio, box], 'box', 'p1')).toBe(false);
    expect(isProjectOnMachine([studio, box], 'box', NO_PROJECT)).toBe(true);
  });
});
