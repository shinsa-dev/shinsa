import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  clearDependencies,
  describeWaitsOnHeading,
  hasRemovableDependencies,
  listDependencyChoices,
  resolveDependencyChoiceLabel,
  resolveDependencyLabel,
  toggleDependency,
} from '@/lib/tasks/dependencies.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

describe('resolveDependencyLabel', () => {
  it('offers waiting before building starts and merging after once it has', () => {
    for (const stage of ['triage', 'waiting_on_tasks', 'planning'] as const) {
      expect(resolveDependencyLabel(createTask({ id: 't', stage }))).toBe('Wait for another task');
    }
    for (const stage of ['awaiting_plan', 'building', 'shipping'] as const) {
      expect(resolveDependencyLabel(createTask({ id: 't', stage }))).toBe('Merge after another task');
    }
  });
});

describe('describeWaitsOnHeading', () => {
  it('says what the dependency holds back and agrees with how many there are', () => {
    const one = [createTask({ id: 'a' })];
    const two = [createTask({ id: 'a' }), createTask({ id: 'b' })];
    expect(describeWaitsOnHeading(createTask({ id: 't', stage: 'waiting_on_tasks' }), one)).toBe(
      'Starts when this finishes'
    );
    expect(describeWaitsOnHeading(createTask({ id: 't', stage: 'waiting_on_tasks' }), two)).toBe(
      'Starts when these finish'
    );
    expect(describeWaitsOnHeading(createTask({ id: 't', stage: 'shipping' }), two)).toBe(
      'Merges when these finish'
    );
  });
});

describe('listDependencyChoices', () => {
  it('lists the tasks already chosen first, then the other open tasks, each in priority order', () => {
    const subject = createTask({ id: 'self', stage: 'waiting_on_tasks', waitsOn: ['late-pick', 'gone'] });
    const state = createShinsaState({
      tasks: [
        subject,
        createTask({ id: 'urgent', priority: 'urgent' }),
        createTask({ id: 'old', createdAt: NOW - 90_000 }),
        createTask({ id: 'late-pick', createdAt: NOW - 1_000 }),
        createTask({ id: 'gone', stage: 'cancelled', createdAt: NOW - 95_000 }),
        createTask({ id: 'merged', stage: 'merged' }),
        createTask({ id: 'dependent', stage: 'waiting_on_tasks', waitsOn: ['self'] }),
      ],
    });
    expect(listDependencyChoices(state, subject).map((task) => task.id)).toEqual([
      'gone',
      'late-pick',
      'urgent',
      'old',
    ]);
  });

  it('offers every other open task when nothing is chosen yet', () => {
    const subject = createTask({ id: 'self' });
    const state = createShinsaState({ tasks: [subject, createTask({ id: 'other' })] });
    expect(listDependencyChoices(state, subject).map((task) => task.id)).toEqual(['other']);
  });
});

describe('dependency commands', () => {
  let spies: ReturnType<typeof spyOnCommands>;
  const blocker = createTask({ id: 'b', title: 'Add login' });

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('adds a task to wait on without dropping the others', async () => {
    const task = createTask({ id: 't', waitsOn: ['a'] });
    expect(await toggleDependency(task, blocker)).toBe(true);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.wait_on', taskId: 't', waitsOn: ['a', 'b'] },
      'Waits on “Add login”.'
    );
  });

  it('removes only the task toggled off', async () => {
    const task = createTask({ id: 't', waitsOn: ['a', 'b'] });
    await toggleDependency(task, blocker);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.wait_on', taskId: 't', waitsOn: ['a'] },
      'No longer waits on “Add login”.'
    );
  });

  it('stops waiting on every task at once', async () => {
    await clearDependencies(createTask({ id: 't', waitsOn: ['a', 'b'] }), null);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.wait_on', taskId: 't', waitsOn: [] },
      'No longer waiting.'
    );
  });

  it('keeps waiting on the task this one is stacked on when it stops waiting on the rest', async () => {
    await clearDependencies(createTask({ id: 't', waitsOn: ['a', 'b'] }), blocker);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.wait_on', taskId: 't', waitsOn: ['b'] },
      'Now waits only on “Add login”, which this task is stacked on.'
    );
  });
});

describe('a task stacked on another one', () => {
  const below = createTask({ id: 'b', title: 'Add login' });

  it('names the task it is stacked on in that task’s choice and leaves the others as they are', () => {
    expect(resolveDependencyChoiceLabel(below, below)).toBe('Stacked on “Add login”');
    expect(resolveDependencyChoiceLabel(below, createTask({ id: 'o', title: 'Other' }))).toBe('Other');
    expect(resolveDependencyChoiceLabel(null, below)).toBe('Add login');
  });

  it('has something to stop waiting on only beside the task it is stacked on', () => {
    expect(hasRemovableDependencies(createTask({ id: 't', waitsOn: ['b'] }), below)).toBe(false);
    expect(hasRemovableDependencies(createTask({ id: 't', waitsOn: ['b', 'o'] }), below)).toBe(true);
    expect(hasRemovableDependencies(createTask({ id: 't', waitsOn: ['b'] }), null)).toBe(true);
    expect(hasRemovableDependencies(createTask({ id: 't' }), null)).toBe(false);
  });
});
