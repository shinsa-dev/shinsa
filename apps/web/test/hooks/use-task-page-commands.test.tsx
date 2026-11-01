import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type * as React from 'react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useTaskPageCommands } from '@/hooks/use-task-page-commands.ts';
import { useTaskView } from '@/hooks/use-task-view.ts';
import { type Command, useRegisteredSections } from '@/lib/command/registry.ts';
import { navigate } from '@/router.ts';
import { spyOnCommands } from '../support/commands.ts';
import { spyOnEngine } from '../support/engine.ts';
import { createGate, createShinsaState, createTask } from '../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const STATE = createShinsaState({
  tasks: [createTask({ id: 't1', worktreePath: '/tmp/t1' })],
  gates: [createGate({ id: 'g1', taskId: 't1', type: 'review' })],
});

function Draft({ children }: { children: React.ReactNode }) {
  return (
    <ReviewDraftProvider enabled draftKey='g1'>
      {children}
    </ReviewDraftProvider>
  );
}

const FINDINGS_STATE = createShinsaState({
  tasks: [
    createTask({
      id: 't1',
      worktreePath: '/tmp/t1',
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    }),
  ],
  gates: [createGate({ id: 'g1', taskId: 't1', type: 'review' })],
});

function usePage(state = STATE) {
  const task = state.tasks.t1;
  if (!task) throw new Error('Missing task');
  const view = useTaskView(state, task.id);
  useTaskPageCommands(state, task, view);
  return { draft: useReviewDraft(), sections: useRegisteredSections() };
}

function find(sections: { commands: Command[] }[], id: string) {
  const command = sections.flatMap((section) => section.commands).find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

describe('useTaskPageCommands', () => {
  it('registers the task page sections for the tab you are on', () => {
    navigate('/tasks/t1?tab=code&mode=changes');
    const { result } = renderHook(() => usePage(), { wrapper: Draft });
    expect(result.current.sections.map((section) => section.id)).toEqual([
      'task.decide',
      'task.view',
      'task.actions',
    ]);
    expect(find(result.current.sections, 'task.t1.tab.code').current).toBe(true);
    const review = find(result.current.sections, 'task.t1.tab.overview');
    act(() => {
      if (review.kind === 'run') review.run();
    });
    expect(location.search).toBe('');
  });

  it('carries the review draft into the decision and clears it once sent', async () => {
    const { result } = renderHook(() => usePage(), { wrapper: Draft });
    act(() => result.current.draft.addComment({ path: 'src/a.ts', line: 1, text: 'Rename this' }));
    expect(find(result.current.sections, 'task.t1.gate.g1.approve').disabled).toBe(
      'Send or clear your comments first'
    );
    const revise = find(result.current.sections, 'task.t1.gate.g1.revise');
    expect(revise.label).toBe('Request changes with 1 comment');
    await act(async () => {
      if (revise.kind === 'page' && revise.page.kind === 'compose') await revise.page.send('Small things');
    });
    expect(spies.sent.mock.calls[0]?.[0]).toEqual({
      type: 'gate.answer',
      gateId: 'g1',
      decision: 'revise',
      response: 'Small things',
      comments: [{ path: 'src/a.ts', side: 'new', line: 1, endLine: null, text: 'Rename this' }],
    });
    expect(result.current.draft.comments).toEqual([]);
    expect(find(result.current.sections, 'task.t1.gate.g1.approve').disabled).toBeUndefined();
  });

  it('follows your choice to fix and approve when the engine can approve after a fix', () => {
    const engine = spyOnEngine();
    const { result } = renderHook(() => usePage(FINDINGS_STATE), { wrapper: Draft });
    expect(find(result.current.sections, 'task.t1.gate.g1.approve').label).toBe('Fix 1 finding');
    act(() => result.current.draft.chooseThenApprove(true));
    expect(find(result.current.sections, 'task.t1.gate.g1.approve').label).toBe('Fix 1 finding and approve');
    expect(find(result.current.sections, 'task.t1.gate.g1.fix_choice').label).toBe('Fix 1 finding');
    engine.mockRestore();
  });

  it('drops the sections when the page unmounts', () => {
    const reader = renderHook(() => useRegisteredSections());
    const page = renderHook(() => usePage(), { wrapper: Draft });
    expect(reader.result.current).not.toEqual([]);
    page.unmount();
    expect(reader.result.current).toEqual([]);
  });
});
