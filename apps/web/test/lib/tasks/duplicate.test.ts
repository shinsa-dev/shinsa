import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import {
  closeAsDuplicate,
  closeDuplicateDialog,
  listDuplicateChoices,
  openDuplicateDialog,
  resolveDuplicateChoiceValue,
  startNotDuplicate,
  useDuplicateDialog,
} from '@/lib/tasks/duplicate.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

describe('the duplicate dialog', () => {
  it('opens for one task from its action and closes again', () => {
    const { result } = renderHook(() => useDuplicateDialog());
    expect(result.current).toBeNull();
    act(() => openDuplicateDialog('t'));
    expect(result.current).toBe('t');
    act(() => closeDuplicateDialog());
    expect(result.current).toBeNull();
    act(() => runTaskAction(createTask({ id: 'copy' }), 'duplicate'));
    expect(result.current).toBe('copy');
    act(() => closeDuplicateDialog());
  });
});

describe('listDuplicateChoices', () => {
  it('lists open tasks first by priority, then finished ones newest first, never itself or a duplicate', () => {
    const task = createTask({ id: 't' });
    const urgent = createTask({ id: 'urgent', priority: 'urgent' });
    const normal = createTask({ id: 'normal' });
    const merged = createTask({ id: 'merged', stage: 'merged', stageChangedAt: NOW - 10 });
    const recent = createTask({ id: 'recent', stage: 'done', stageChangedAt: NOW });
    const copy = createTask({
      id: 'copy',
      stage: 'cancelled',
      duplicate: { of: 'normal', by: 'you', why: null },
    });
    const home = createTask({ id: 'home', watchHome: true });
    const state = createShinsaState({ tasks: [task, normal, merged, urgent, recent, copy, home] });
    expect(listDuplicateChoices(state, task).map((choice) => choice.id)).toEqual([
      'urgent',
      'normal',
      'recent',
      'merged',
    ]);
  });

  it('matches a choice by its handle, title or id', () => {
    expect(resolveDuplicateChoiceValue(createTask({ id: 'a', handle: 'SW-3', title: 'Add dark mode' }))).toBe(
      'SW-3 Add dark mode a'
    );
    expect(resolveDuplicateChoiceValue(createTask({ id: 'b', handle: null, title: 'Untriaged' }))).toBe(
      'Untriaged b'
    );
  });
});

describe('closing and restarting', () => {
  it('sends the mark with the original named, and Not a duplicate from its action', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await closeAsDuplicate(task, createTask({ id: 'o', handle: 'SW-1', title: 'Add dark mode' }));
    await closeAsDuplicate(task, createTask({ id: 'p', handle: null, title: 'Untriaged' }));
    await startNotDuplicate(task);
    runTaskAction(task, 'notDuplicate');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.mark_duplicate', taskId: 't', duplicateOf: 'o' }, 'Closed as a duplicate of SW-1.'],
      [{ type: 'task.mark_duplicate', taskId: 't', duplicateOf: 'p' }, 'Closed as a duplicate of Untriaged.'],
      [{ type: 'task.clear_duplicate', taskId: 't' }, 'Started again, as not a duplicate.'],
      [{ type: 'task.clear_duplicate', taskId: 't' }, 'Started again, as not a duplicate.'],
    ] as never);
    spies.restore();
  });
});
