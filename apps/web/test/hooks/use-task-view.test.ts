import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useTaskView } from '@/hooks/use-task-view.ts';
import { navigate } from '@/router.ts';
import { createGate, createShinsaState, createTask } from '../support/state.ts';

function view(state = createShinsaState({ tasks: [createTask({ id: 't1' })] }), taskId = 't1') {
  return renderHook(() => useTaskView(state, taskId));
}

describe('useTaskView', () => {
  it('opens on the overview of a task with code', () => {
    const { result } = view();
    expect(result.current.task?.id).toBe('t1');
    expect(result.current.tabs).toEqual(['overview', 'code', 'chat']);
    expect(result.current.tab).toBe('overview');
    expect(result.current.codeView).toBe('review');
    expect(result.current.chatRunId).toBeNull();
    expect(result.current.lead).toBeUndefined();
    expect(result.current.reviewing).toBe(false);
    expect(result.current.draftKey).toBe('none');
  });

  it('reads the tab, code view and run from the URL', () => {
    navigate('/tasks/t1?tab=chat&view=changes&run=r1');
    const { result } = view();
    expect(result.current.tab).toBe('chat');
    expect(result.current.codeView).toBe('changes');
    expect(result.current.chatRunId).toBe('r1');
  });

  it('falls back to the overview for a tab the task does not have yet', () => {
    navigate('/tasks/t1?tab=code');
    const { result } = view(createShinsaState({ tasks: [createTask({ id: 't1', stage: 'planning' })] }));
    expect(result.current.tabs).toEqual(['overview', 'chat']);
    expect(result.current.tab).toBe('overview');
  });

  it('has no task, tabs or gates for an unknown task', () => {
    const { result } = view(createShinsaState({}), 'gone');
    expect(result.current.task).toBeNull();
    expect(result.current.tabs).toEqual([]);
    expect(result.current.lead).toBeUndefined();
  });

  it('leads with a pause or question over the decision, and keys the draft to the decision', () => {
    const decision = createGate({ id: 'g1', taskId: 't1', kind: 'review' });
    const failure = createGate({ id: 'g2', taskId: 't1', kind: 'review', purpose: 'failure' });
    const { result } = view(
      createShinsaState({ tasks: [createTask({ id: 't1' })], gates: [decision, failure] })
    );
    expect(result.current.lead?.id).toBe('g2');
    expect(result.current.reviewing).toBe(true);
    expect(result.current.draftKey).toBe('g1');
  });

  it('reviews on a merge gate but not on a plan', () => {
    const merge = view(
      createShinsaState({
        tasks: [createTask({ id: 't1' })],
        gates: [createGate({ id: 'g1', taskId: 't1', kind: 'merge' })],
      })
    );
    expect(merge.result.current.reviewing).toBe(true);
    expect(merge.result.current.lead?.id).toBe('g1');
    const plan = view(
      createShinsaState({
        tasks: [createTask({ id: 't1' })],
        gates: [createGate({ id: 'g1', taskId: 't1', kind: 'spec' })],
      })
    );
    expect(plan.result.current.reviewing).toBe(false);
  });

  it('switches tabs and clears what belonged to the old one', () => {
    navigate('/tasks/t1?tab=chat&run=r1&view=changes&file=a.ts&layout=cards');
    const { result } = view();
    act(() => result.current.applyTab('code'));
    expect(location.search).toBe('?tab=code&layout=cards');
    act(() => result.current.applyTab('overview'));
    expect(location.search).toBe('?layout=cards');
  });

  it('switches the code view on the Code tab', () => {
    navigate('/tasks/t1?file=a.ts&run=r1');
    const { result } = view();
    act(() => result.current.applyCodeView('changes'));
    expect(location.search).toBe('?tab=code&view=changes');
    act(() => result.current.applyCodeView('review'));
    expect(location.search).toBe('?tab=code');
  });

  it('jumps to what the Now card points at', () => {
    navigate('/tasks/t1?file=a.ts');
    const { result } = view();
    act(() => result.current.applyNowTarget('agent', 'r2'));
    expect(location.search).toBe('?tab=chat&run=r2');
    act(() => result.current.applyNowTarget('agent'));
    expect(location.search).toBe('?tab=chat');
    act(() => result.current.applyNowTarget('changes'));
    expect(location.search).toBe('?tab=code&view=changes');
  });
});
