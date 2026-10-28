import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import { closeForkDialog, forkTask, openForkDialog, useForkDialog } from '@/lib/tasks/fork.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';

describe('the fork dialog', () => {
  it('opens for one task and closes again', () => {
    const { result } = renderHook(() => useForkDialog());
    expect(result.current).toBeNull();
    act(() => openForkDialog('t'));
    expect(result.current).toBe('t');
    act(() => closeForkDialog());
    expect(result.current).toBeNull();
  });

  it('opens from the task action', () => {
    const { result } = renderHook(() => useForkDialog());
    act(() => runTaskAction(createTask({ id: 'source' }), 'fork'));
    expect(result.current).toBe('source');
    act(() => closeForkDialog());
  });
});

describe('forking a task', () => {
  it('creates the fork in the source task’s project, or in its own when it has no repository', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't', handle: 'SW-2', repoId: 'r1', projectId: null });
    const state = createShinsaState({ tasks: [task], repos: [createRepo({ id: 'r1', projectId: 'p' })] });
    await forkTask(state, task, 'Fix it in Safari');
    await forkTask(createShinsaState({}), { ...task, repoId: null, projectId: 'own' }, 'Again');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'task.create', request: 'Fix it in Safari', repoId: 'r1', projectId: 'p', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
      [
        { type: 'task.create', request: 'Again', repoId: null, projectId: 'own', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
    ] as never);
    spies.restore();
  });
});
