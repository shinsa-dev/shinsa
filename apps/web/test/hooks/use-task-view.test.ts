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
    expect(result.current.codeModes).toEqual(['changes', 'files']);
    expect(result.current.chatRunId).toBeNull();
    expect(result.current.lead).toBeUndefined();
    expect(result.current.reviewing).toBe(false);
    expect(result.current.draftKey).toBe('none');
  });

  it('reads the tab and run from the URL', () => {
    navigate('/tasks/t1?tab=chat&run=r1');
    const { result } = view();
    expect(result.current.tab).toBe('chat');
    expect(result.current.chatRunId).toBe('r1');
  });

  it('a task that has not built yet browses its repository in Files alone', () => {
    navigate('/tasks/t1?tab=code');
    const { result } = view(
      createShinsaState({ tasks: [createTask({ id: 't1', stage: 'planning', repoId: 'repo-1' })] })
    );
    expect(result.current.tab).toBe('code');
    expect(result.current.codeModes).toEqual(['files']);
  });

  it('falls back to the overview for a tab the task does not have', () => {
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
    const decision = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const failure = createGate({ id: 'g2', taskId: 't1', type: 'failure' });
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
        gates: [createGate({ id: 'g1', taskId: 't1', type: 'merge' })],
      })
    );
    expect(merge.result.current.reviewing).toBe(true);
    expect(merge.result.current.lead?.id).toBe('g1');
    const plan = view(
      createShinsaState({
        tasks: [createTask({ id: 't1' })],
        gates: [createGate({ id: 'g1', taskId: 't1', type: 'plan' })],
      })
    );
    expect(plan.result.current.reviewing).toBe(false);
  });

  it('switches tabs and clears what belonged to the old one', () => {
    navigate('/tasks/t1?tab=chat&run=r1&mode=changes&file=a.ts&line=4&layout=cards');
    const { result } = view();
    act(() => result.current.applyTab('code'));
    expect(location.search).toBe('?tab=code&layout=cards');
    act(() => result.current.applyTab('overview'));
    expect(location.search).toBe('?layout=cards');
  });

  it('switches the code mode on the Code tab, keeping the open file', () => {
    navigate('/tasks/t1?file=a.ts&run=r1');
    const { result } = view();
    act(() => result.current.applyCodeMode('files'));
    expect(location.search).toBe('?file=a.ts&tab=code&mode=files');
    act(() => result.current.applyCodeMode('changes'));
    expect(location.search).toBe('?file=a.ts&tab=code');
  });

  it('jumps to what the Now card points at', () => {
    navigate('/tasks/t1?file=a.ts');
    const { result } = view();
    act(() => result.current.applyNowTarget('agent', 'r2'));
    expect(location.search).toBe('?tab=chat&run=r2');
    act(() => result.current.applyNowTarget('agent'));
    expect(location.search).toBe('?tab=chat');
    act(() => result.current.applyNowTarget('changes'));
    expect(location.search).toBe('?tab=code&mode=changes');
    act(() => result.current.applyNowTarget('review'));
    expect(location.search).toBe('?tab=review');
  });
});
