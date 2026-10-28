import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import { closeForkDialog, openForkDialog, useForkDialog } from '@/lib/tasks/fork.ts';
import { createTask } from '../../support/state.ts';

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
